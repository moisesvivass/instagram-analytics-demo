import json
import logging
import traceback
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from app.limiter import limiter
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AiInsight, CsvPost, HqGlanceCache, InstagramSnapshot, Post
from app.services.ai_insights import _compute_benchmarks, generate_insights
from app.services.instagram import fetch_posts
from app.services.mock_data import get_mock_hq_glance, get_mock_insights
from app.utils import next_monday_iso, week_start_utc

_HQ_CACHE_TTL_HOURS = 24
_HQ_DAILY_REFRESH_LIMIT = 3

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/insights", tags=["insights"])


def _csv_post_to_dict(p: CsvPost) -> dict:
    return {
        "post_id":         p.post_id,
        "caption":         p.description or "",
        "media_type":      p.post_type or "IMAGE",
        "timestamp":       p.publish_time.isoformat() if p.publish_time else "",
        "like_count":      p.likes,
        "comments_count":  p.comments,
        "reach":           p.reach,
        "saved":           p.saves,
        "shares":          p.shares,
        "engagement_rate": 0.0,
        "thumbnail_url":   "",
    }


def _get_merged_posts(api_posts: list[dict], db: Session) -> list[dict]:
    """Merge live API posts and historical CSV posts, deduplicated by post_id.
    API posts take precedence over CSV posts for the same post_id."""
    merged: dict[str, dict] = {}
    for r in db.query(CsvPost).all():
        d = _csv_post_to_dict(r)
        merged[d["post_id"]] = d
    for p in api_posts:
        merged[p["post_id"]] = p
    return list(merged.values())


def _weekly_real_count(db: Session) -> int:
    return (
        db.query(AiInsight)
        .filter(AiInsight.source == "real", AiInsight.generated_at >= week_start_utc())
        .count()
    )


def _parse_insight_field(value: str):
    """Return parsed JSON list if valid, otherwise return the raw string (legacy fallback)."""
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    return value


def _serialize_insight_field(value) -> str:
    """Serialize list to JSON string for Text DB column storage."""
    return json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value


def _row_to_dict(record: AiInsight) -> dict:
    try:
        action_board = json.loads(record.action_board) if record.action_board else []
    except Exception:
        action_board = []
    return {
        "what_working": _parse_insight_field(record.what_working),
        "what_flopping": _parse_insight_field(record.what_flopping),
        "briefing": record.briefing,
        "action_board": action_board,
        "generated_at": record.generated_at.isoformat(),
        "source": record.source,
    }


@router.get("/latest")
async def latest_insights(db: Session = Depends(get_db)):
    settings = get_settings()
    calls_used = _weekly_real_count(db) if not settings.use_mock_data else 0

    if settings.use_mock_data:
        return {**get_mock_insights(), "source": "mock", "calls_used": 0, "calls_max": 3}

    record = (
        db.query(AiInsight)
        .filter(AiInsight.source == "real")
        .order_by(AiInsight.generated_at.desc())
        .first()
    )
    if record is None:
        return {**get_mock_insights(), "source": "mock", "calls_used": calls_used, "calls_max": 3}

    return {**_row_to_dict(record), "calls_used": calls_used, "calls_max": 3}


_MEDIA_LABELS: dict[str, str] = {
    "REEL": "Reels",
    "CAROUSEL_ALBUM": "Carousels",
    "IMAGE": "Static photos",
}
_MEDIA_SINGULAR: dict[str, str] = {
    "REEL": "reel",
    "CAROUSEL_ALBUM": "carousel",
    "IMAGE": "static photo",
}


def _compute_hq_glance(db: Session) -> dict:
    """Compute HQ Glance fields from DB — pure Python, no Claude call."""
    now = datetime.utcnow()
    cutoff_7d = now - timedelta(days=7)

    top_post_row = (
        db.query(Post)
        .filter(Post.timestamp >= cutoff_7d)
        .order_by(Post.reach.desc())
        .first()
    )
    if top_post_row:
        snippet = (top_post_row.caption or "")[:60].strip()
        label = f'"{snippet}…"' if snippet else top_post_row.media_type
        top_post = f"{label} — {top_post_row.reach:,} reach, {top_post_row.saved} saves"
    else:
        top_post = "No posts recorded in the last 7 days"

    latest_snap = (
        db.query(InstagramSnapshot)
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )
    snap_7d = (
        db.query(InstagramSnapshot)
        .filter(InstagramSnapshot.captured_at <= cutoff_7d)
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )
    if latest_snap and snap_7d:
        delta = latest_snap.followers - snap_7d.followers
        sign = "+" if delta >= 0 else ""
        follower_growth = (
            f"{sign}{delta:,} followers in the last 7 days "
            f"({latest_snap.followers:,} total)"
        )
    elif latest_snap:
        follower_growth = f"{latest_snap.followers:,} followers — not enough history for a delta yet"
    else:
        follower_growth = "No snapshot data available yet"

    signal_row = (
        db.query(
            Post.media_type,
            func.avg(Post.saved + Post.shares).label("avg_value"),
        )
        .group_by(Post.media_type)
        .order_by(func.avg(Post.saved + Post.shares).desc())
        .first()
    )
    worst_fmt = (
        db.query(Post.media_type, func.avg(Post.saved + Post.shares).label("avg_value"))
        .group_by(Post.media_type)
        .order_by(func.avg(Post.saved + Post.shares).asc())
        .first()
    )

    if signal_row and signal_row.avg_value is not None:
        type_label = _MEDIA_LABELS.get(signal_row.media_type, signal_row.media_type)
        best_singular = _MEDIA_SINGULAR.get(signal_row.media_type, signal_row.media_type)
        top_signal = (
            f"{type_label} are your top-performing format — "
            f"averaging {signal_row.avg_value:.1f} saves + shares per post"
        )
        if worst_fmt and worst_fmt.media_type != signal_row.media_type:
            worst_label = _MEDIA_LABELS.get(worst_fmt.media_type, worst_fmt.media_type)
            priority_action = (
                f"Post a {best_singular} this week — "
                f"{type_label} average {signal_row.avg_value:.1f} saves+shares "
                f"vs {worst_fmt.avg_value:.1f} for {worst_label.lower()}"
            )
        else:
            priority_action = (
                f"Post a {best_singular} this week — "
                f"your top format averaging {signal_row.avg_value:.1f} saves+shares per post"
            )
    else:
        top_signal = "Not enough post data yet to identify a top signal"
        priority_action = "Sync your posts to start seeing format performance recommendations"

    return {
        "top_post": top_post,
        "follower_growth": follower_growth,
        "top_signal": top_signal,
        "priority_action": priority_action,
        "generated_at": now.isoformat(),
    }


def _save_hq_cache(db: Session, data: dict, *, reset_daily: bool = False) -> HqGlanceCache:
    """Upsert the single HqGlanceCache row."""
    row = db.query(HqGlanceCache).first()
    today = date.today()
    if row is None:
        row = HqGlanceCache(
            top_post=data["top_post"],
            follower_growth=data["follower_growth"],
            top_signal=data["top_signal"],
            priority_action=data["priority_action"],
            generated_at=datetime.utcnow(),
            daily_refresh_count=1 if reset_daily else 0,
            daily_refresh_date=today if reset_daily else None,
        )
        db.add(row)
    else:
        row.top_post = data["top_post"]
        row.follower_growth = data["follower_growth"]
        row.top_signal = data["top_signal"]
        row.priority_action = data["priority_action"]
        row.generated_at = datetime.utcnow()
        if reset_daily:
            if row.daily_refresh_date == today:
                row.daily_refresh_count += 1
            else:
                row.daily_refresh_count = 1
                row.daily_refresh_date = today
    db.commit()
    return row


@router.get("/hq-glance")
def hq_glance(db: Session = Depends(get_db)):
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_hq_glance()

    # Return cached result if < 24 hours old
    row = db.query(HqGlanceCache).first()
    if row and (datetime.utcnow() - row.generated_at).total_seconds() < _HQ_CACHE_TTL_HOURS * 3600:
        return {
            "top_post":        row.top_post,
            "follower_growth": row.follower_growth,
            "top_signal":      row.top_signal,
            "priority_action": row.priority_action,
            "generated_at":    row.generated_at.isoformat(),
        }

    # Cache miss or expired — recompute and save
    data = _compute_hq_glance(db)
    _save_hq_cache(db, data)
    return data


@router.post("/hq-glance/refresh")
@limiter.limit("10/hour")
def hq_glance_refresh(request: Request, db: Session = Depends(get_db)):
    """Force-regenerate the HQ Glance. Max {_HQ_DAILY_REFRESH_LIMIT} times per calendar day."""
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_hq_glance()

    today = date.today()
    row = db.query(HqGlanceCache).first()

    # Check daily refresh limit
    if row and row.daily_refresh_date == today and row.daily_refresh_count >= _HQ_DAILY_REFRESH_LIMIT:
        return JSONResponse(
            status_code=429,
            content={
                "detail": "Daily refresh limit reached",
                "refreshes_used": row.daily_refresh_count,
                "refreshes_max": _HQ_DAILY_REFRESH_LIMIT,
                "resets_at": "midnight tonight",
            },
        )

    data = _compute_hq_glance(db)
    _save_hq_cache(db, data, reset_daily=True)
    return data


@router.get("/format-performance")
def format_performance(db: Session = Depends(get_db)):
    settings = get_settings()
    if settings.use_mock_data:
        from app.services.mock_data import get_mock_format_performance
        return get_mock_format_performance()

    rows = (
        db.query(
            Post.media_type,
            func.count(Post.id).label("post_count"),
            func.avg(Post.saved).label("avg_saves"),
            func.avg(Post.shares).label("avg_shares"),
            func.avg(Post.reach).label("avg_reach"),
        )
        .group_by(Post.media_type)
        .all()
    )

    _LABELS = {"REEL": "Reels", "CAROUSEL_ALBUM": "Carousels", "IMAGE": "Static"}
    return [
        {
            "media_type": row.media_type,
            "label": _LABELS.get(row.media_type, row.media_type),
            "post_count": row.post_count,
            "avg_saves": round(float(row.avg_saves or 0), 1),
            "avg_shares": round(float(row.avg_shares or 0), 1),
            "avg_reach": round(float(row.avg_reach or 0)),
        }
        for row in rows
    ]


@router.post("/generate")
@limiter.limit("10/hour")
async def force_generate(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()

    if not settings.use_mock_data:
        count = _weekly_real_count(db)
        if count >= 3:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Weekly limit reached",
                    "calls_used": count,
                    "calls_max": 3,
                    "resets_at": next_monday_iso(),
                },
            )

    try:
        if settings.use_mock_data:
            result = get_mock_insights()
            source = "mock"
        else:
            api_posts  = await fetch_posts(db=db)
            all_posts  = _get_merged_posts(api_posts, db)
            benchmarks = _compute_benchmarks(all_posts)
            result     = await generate_insights(all_posts, benchmarks)
            source     = "real"

        record = AiInsight(
            what_working=_serialize_insight_field(result["what_working"]),
            what_flopping=_serialize_insight_field(result["what_flopping"]),
            briefing=result["briefing"],
            action_board=json.dumps(result.get("action_board", [])),
            generated_at=datetime.utcnow(),
            source=source,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        calls_used = count + 1 if not settings.use_mock_data else 0
        return {**_row_to_dict(record), "calls_used": calls_used, "calls_max": 3}
    except Exception as exc:
        logger.error("force_generate failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=502, detail="Failed to generate insights") from exc
