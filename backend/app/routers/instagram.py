import logging
from datetime import datetime, timedelta
from math import log

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import CsvPost, InstagramSnapshot, Post
from app.services.instagram import fetch_comments, fetch_growth, fetch_overview, fetch_posts, fetch_reach_by_surface, fetch_reach_chart, fetch_token_info
from app.services.mock_data import get_mock_growth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/instagram", tags=["instagram"])


def _compute_growth_metrics(db: Session, current_followers: int) -> dict:
    """Return ytd_start_followers, monthly_pace, and per-metric week-over-week delta pcts."""
    settings = get_settings()
    now = datetime.utcnow()
    current_year = now.year
    jan_1_str = f"{current_year}-01-01"

    if settings.use_mock_data:
        growth = get_mock_growth()
        if not growth:
            return {
                "ytd_start_followers": current_followers,
                "monthly_pace": 0,
                "followers_delta_pct": None,
            }

        # Find the last record on or before Jan 1
        baseline_record = growth[0]
        for r in growth:
            if r["date"] <= jan_1_str:
                baseline_record = r
        ytd_start = baseline_record["followers"]

        # Monthly pace: (followers 28 days ago → latest) / 4 weeks × 4.33
        if len(growth) >= 29:
            weekly_change = (growth[-1]["followers"] - growth[-29]["followers"]) / 4
            monthly_pace = round(weekly_change * 4.33)
        else:
            monthly_pace = 0

        # Followers delta vs 7 days ago
        followers_delta_pct: float | None = None
        if len(growth) >= 8:
            f7 = growth[-8]["followers"]
            if f7 > 0:
                followers_delta_pct = round((growth[-1]["followers"] - f7) / f7 * 100, 1)

        return {
            "ytd_start_followers": ytd_start,
            "monthly_pace": monthly_pace,
            "followers_delta_pct": followers_delta_pct,
            # Mock deltas for metrics without historical snapshot data
            "reach_28d_delta_pct": 12.0,
            "profile_views_delta_pct": -0.8,
            "accounts_engaged_delta_pct": 5.2,
            "interactions_delta_pct": 8.1,
        }

    # ── Real mode: query InstagramSnapshot ──────────────────────────────────
    jan_1 = datetime(current_year, 1, 1)

    # YTD baseline: latest snapshot on or before Jan 7
    snap_ytd = (
        db.query(InstagramSnapshot)
        .filter(InstagramSnapshot.captured_at <= jan_1 + timedelta(days=7))
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    ) or db.query(InstagramSnapshot).order_by(InstagramSnapshot.captured_at.asc()).first()

    ytd_start = snap_ytd.followers if snap_ytd else current_followers

    # Monthly pace from last 28 days
    cutoff_28d = now - timedelta(days=28)
    snap_oldest_28d = (
        db.query(InstagramSnapshot)
        .filter(InstagramSnapshot.captured_at >= cutoff_28d)
        .order_by(InstagramSnapshot.captured_at.asc())
        .first()
    )
    snap_latest = (
        db.query(InstagramSnapshot)
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )
    if snap_oldest_28d and snap_latest:
        weekly_change = (snap_latest.followers - snap_oldest_28d.followers) / 4
        monthly_pace = round(weekly_change * 4.33)
    else:
        monthly_pace = 0

    # Week-over-week deltas: compare latest snapshot to snapshot from ≥7 days ago
    cutoff_7d = now - timedelta(days=7)
    snap_7d = (
        db.query(InstagramSnapshot)
        .filter(InstagramSnapshot.captured_at <= cutoff_7d)
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )

    total_snaps = db.query(InstagramSnapshot).count()
    logger.info(
        "[growth_metrics] total_snapshots=%d | snap_latest=%s | snap_7d=%s | snap_7d_followers=%s | current_followers=%s",
        total_snaps,
        snap_latest.captured_at.isoformat() if snap_latest else "NONE",
        snap_7d.captured_at.isoformat() if snap_7d else "NONE",
        snap_7d.followers if snap_7d else "NONE",
        current_followers,
    )

    def _pct(current: int, previous: int) -> float | None:
        if previous and previous > 0:
            return round((current - previous) / previous * 100, 1)
        return None

    if snap_7d and snap_latest:
        followers_delta_pct = _pct(current_followers, snap_7d.followers)
        reach_delta_pct = _pct(snap_latest.reach, snap_7d.reach)
        profile_views_delta_pct = _pct(snap_latest.profile_views, snap_7d.profile_views)
        accounts_engaged_delta_pct = _pct(snap_latest.engaged_accounts, snap_7d.engaged_accounts)
        interactions_delta_pct = _pct(snap_latest.interactions, snap_7d.interactions)
    else:
        followers_delta_pct = reach_delta_pct = profile_views_delta_pct = None
        accounts_engaged_delta_pct = interactions_delta_pct = None

    logger.info(
        "[growth_metrics] followers_delta_pct=%s | reach_delta_pct=%s | reason=%s",
        followers_delta_pct,
        reach_delta_pct,
        "OK" if snap_7d else "NO_SNAPSHOT_7D_AGO",
    )

    return {
        "ytd_start_followers": ytd_start,
        "monthly_pace": monthly_pace,
        "followers_delta_pct": followers_delta_pct,
        "reach_28d_delta_pct": reach_delta_pct,
        "profile_views_delta_pct": profile_views_delta_pct,
        "accounts_engaged_delta_pct": accounts_engaged_delta_pct,
        "interactions_delta_pct": interactions_delta_pct,
    }


@router.get("/overview")
async def overview(db: Session = Depends(get_db)):
    try:
        data = await fetch_overview()
        growth_metrics = _compute_growth_metrics(db, data["followers"])
        return {**data, **growth_metrics}
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch overview") from exc


@router.get("/growth")
async def growth():
    try:
        return await fetch_growth()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch growth data") from exc


def _perf_score(p: dict) -> float:
    reach = p.get("reach", 0)
    shares = p.get("shares", 0)
    saved = p.get("saved", 0)
    return (shares * 4 + saved * 3) * log(reach + 1)


_FALLBACK_AVG_REACH = 872.0


def _compute_avg_reach(db: Session) -> float:
    """Compute average reach from the posts table. Falls back to a safe default if empty."""
    result = db.query(func.avg(Post.reach)).scalar()
    return float(result) if result else _FALLBACK_AVG_REACH


def _perf_label(p: dict, avg_reach: float) -> str:
    reach = p.get("reach", 0)
    shares = p.get("shares", 0)
    saved = p.get("saved", 0)
    high_reach = reach >= avg_reach
    high_value = (shares + saved) >= 5
    if high_reach and high_value:
        return "winner"
    elif not high_reach and high_value:
        return "promising"
    elif high_reach and not high_value:
        return "underperformer"
    return "neutral"


@router.get("/posts")
async def posts(sort_by: str = "date", db: Session = Depends(get_db)):
    valid_sorts = {"date", "engagement_rate", "reach", "saved", "shares", "performance"}
    if sort_by not in valid_sorts:
        raise HTTPException(status_code=400, detail=f"sort_by must be one of {valid_sorts}")
    try:
        data = await fetch_posts(db=db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch posts") from exc

    avg_reach = _compute_avg_reach(db)
    for p in data:
        p["perf_score"] = round(_perf_score(p), 1)
        p["perf_label"] = _perf_label(p, avg_reach)

    if sort_by == "performance":
        return sorted(data, key=_perf_score, reverse=True)
    key = "timestamp" if sort_by == "date" else sort_by
    return sorted(data, key=lambda p: p.get(key, 0), reverse=True)


@router.get("/reach-chart")
async def reach_chart():
    try:
        return await fetch_reach_chart()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch reach chart") from exc


@router.get("/this-week")
def this_week(db: Session = Depends(get_db)):
    """Weekly shares + saves from the DB posts table — no Instagram API call."""
    now = datetime.utcnow()
    monday_this = now - timedelta(
        days=now.weekday(),
        hours=now.hour, minutes=now.minute,
        seconds=now.second, microseconds=now.microsecond,
    )
    monday_last = monday_this - timedelta(days=7)

    def _week_agg(start, end=None):
        q = db.query(
            func.sum(Post.shares),
            func.sum(Post.saved),
            func.sum(Post.reach),
            func.count(Post.id),
        ).filter(Post.timestamp >= start)
        if end:
            q = q.filter(Post.timestamp < end)
        row = q.one()
        return (row[0] or 0), (row[1] or 0), (row[2] or 0), (row[3] or 0)

    shares_this, saves_this, reach_this, posts_this = _week_agg(monday_this)
    shares_last, saves_last, reach_last, posts_last = _week_agg(monday_last, monday_this)

    def _delta(cur: int, prev: int) -> float | None:
        return round((cur - prev) / prev * 100, 1) if prev > 0 else None

    return {
        "shares_this_week": shares_this,
        "shares_delta_pct": _delta(shares_this, shares_last),
        "saves_this_week":  saves_this,
        "saves_delta_pct":  _delta(saves_this, saves_last),
        "reach_this_week":  reach_this,
        "reach_delta_pct":  _delta(reach_this, reach_last),
        "posts_this_week":  posts_this,
        "posts_delta_pct":  _delta(posts_this, posts_last),
    }


@router.get("/reach-sources")
async def reach_sources():
    """Return 28-day reach broken down by surface: REEL, STORY, CAROUSEL."""
    try:
        return await fetch_reach_by_surface()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch reach sources") from exc


@router.get("/comments")
async def comments():
    try:
        return await fetch_comments()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch comments") from exc


@router.get("/token-status")
async def token_status():
    """Return Instagram access token expiry info. Used by the frontend token monitor banner."""
    try:
        return await fetch_token_info()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch token info") from exc


@router.get("/last-reel")
async def last_reel(db: Session = Depends(get_db)):
    """
    Return the most recent Reel with watch time and cold streak risk assessment.
    Cold streak rule: if a reel gets < 1,000 views in 6h, do NOT promote via Stories.
    Low watch time on one reel lowers the initial test pool for the next reel (~72h penalty).
    """
    settings = get_settings()

    if settings.use_mock_data:
        now = datetime.utcnow()
        return {
            "post_id": "mock_reel_001",
            "caption": "POV: you finally find a foundation that matches your undertone perfectly",
            "timestamp": (now - timedelta(hours=4)).isoformat(),
            "hours_since_posted": 4.0,
            "avg_watch_time_sec": 7.2,
            "video_views": None,
            "reach": 1840,
            "shares": 8,
            "saved": 14,
            "cold_streak_risk": "ok",
            "signal": "Watch time 7.2s — healthy. No cold streak risk.",
        }

    post = (
        db.query(Post)
        .filter(Post.media_type.in_(["REEL", "VIDEO"]))
        .order_by(Post.timestamp.desc())
        .first()
    )

    if not post:
        return {"cold_streak_risk": "unknown", "signal": "No reels found."}

    # Compute 60-day avg reach for reels dynamically — used as the baseline for cold streak detection.
    # A reel below 50% of avg reach after 6h is a stronger cold streak signal than watch time alone.
    cutoff_60d = datetime.utcnow() - timedelta(days=60)
    avg_reach_result = (
        db.query(func.avg(Post.reach))
        .filter(Post.media_type.in_(["REEL", "VIDEO"]), Post.timestamp >= cutoff_60d)
        .scalar()
    )
    avg_reach = int(avg_reach_result) if avg_reach_result else 1000

    now = datetime.utcnow()
    hours_since = round((now - post.timestamp).total_seconds() / 3600, 1)
    watch = post.avg_watch_time_sec
    views = post.video_views
    reach = post.reach
    reach_pct = round(reach / avg_reach * 100) if avg_reach > 0 else None

    low_watch = watch is not None and watch < 5.0
    low_reach = reach_pct is not None and reach_pct < 50  # below 50% of 60d avg = underperforming

    # video_views is always None for this account — Instagram Graph API does not return it.
    # Keep the branch for future-proofing if the API starts returning views.
    early = hours_since <= 6

    if early:
        if (views is not None and views < 1000) or low_watch:
            risk = "critical"
            signal = f"Posted {hours_since}h ago — do NOT promote via Stories. Low early traction risks lowering the next reel's test pool."
        elif low_reach:
            risk = "warning"
            signal = f"Only {reach_pct}% of your avg reach ({avg_reach:,}) in {hours_since}h. Monitor before promoting via Stories."
        elif watch is not None and watch < 6.5:
            risk = "warning"
            signal = f"Watch time {watch}s — below average. Monitor before promoting via Stories."
        else:
            risk = "ok"
            signal = f"Watch time {watch}s — healthy. Safe to promote via Stories."
    else:
        if low_watch and low_reach:
            risk = "critical"
            signal = f"Watch time {watch}s + reach at {reach_pct}% of avg. Strong cold streak signal — next reel may start with a smaller test pool."
        elif low_watch or low_reach:
            risk = "warning"
            detail = f"watch time {watch}s" if low_watch else f"reach at {reach_pct}% of avg ({avg_reach:,})"
            signal = f"Underperforming: {detail}. Next reel may have a smaller initial test pool."
        else:
            risk = "ok"
            signal = f"Watch time {watch}s, reach {reach:,} ({reach_pct}% of avg). No cold streak risk."

    return {
        "post_id": post.post_id,
        "caption": (post.caption or "")[:120],
        "timestamp": post.timestamp.isoformat(),
        "hours_since_posted": hours_since,
        "avg_watch_time_sec": watch,
        "video_views": views,
        "reach": reach,
        "reach_pct_of_avg": reach_pct,
        "avg_reach_baseline": avg_reach,
        "shares": post.shares,
        "saved": post.saved,
        "cold_streak_risk": risk,
        "signal": signal,
    }


@router.get("/posting-heatmap")
def posting_heatmap(db: Session = Depends(get_db)):
    """
    Return shares+saves performance score grouped by day-of-week and hour (UTC).
    Timestamps in both tables are stored as UTC. Frontend converts to EST display.
    Score = shares*2 + saves  (matches post_weighted_score formula).
    Returns list of { dow, hour, posts, shares, saves, score }.
    """
    settings = get_settings()

    if settings.use_mock_data:
        # Peaks at Thu/Fri 22 UTC (6pm EST). shares*2 + saves = score exactly.
        peak_slots = [
            {"dow": 4, "hour": 22, "posts": 6, "shares": 61, "saves": 30},
            {"dow": 3, "hour": 22, "posts": 6, "shares": 52, "saves": 31},
            {"dow": 0, "hour": 23, "posts": 4, "shares": 38, "saves": 17},
            {"dow": 1, "hour": 22, "posts": 6, "shares": 29, "saves": 10},
            {"dow": 6, "hour": 22, "posts": 2, "shares": 22, "saves":  4},
            {"dow": 4, "hour": 23, "posts": 3, "shares":  9, "saves":  3},
            {"dow": 2, "hour": 22, "posts": 2, "shares": 11, "saves":  6},
            {"dow": 5, "hour": 20, "posts": 4, "shares": 14, "saves":  3},
            {"dow": 3, "hour": 23, "posts": 4, "shares": 10, "saves":  5},
        ]
        return [{**s, "score": s["shares"] * 2 + s["saves"]} for s in peak_slots]

    rows = db.execute(
        text("""
            SELECT dow, hour_utc,
                   SUM(posts)        AS posts,
                   SUM(total_shares) AS shares,
                   SUM(total_saves)  AS saves,
                   SUM(total_shares) * 2 + SUM(total_saves) AS score
            FROM (
                SELECT
                    EXTRACT(DOW  FROM timestamp)::int AS dow,
                    EXTRACT(HOUR FROM timestamp)::int AS hour_utc,
                    COUNT(*)    AS posts,
                    SUM(shares) AS total_shares,
                    SUM(saved)  AS total_saves
                FROM posts
                WHERE media_type IN ('REEL', 'VIDEO')
                GROUP BY dow, hour_utc
                UNION ALL
                SELECT
                    EXTRACT(DOW  FROM publish_time)::int AS dow,
                    EXTRACT(HOUR FROM publish_time)::int AS hour_utc,
                    COUNT(*)    AS posts,
                    SUM(shares) AS total_shares,
                    SUM(saves)  AS total_saves
                FROM csv_posts
                WHERE publish_time IS NOT NULL
                GROUP BY dow, hour_utc
            ) combined
            GROUP BY dow, hour_utc
            ORDER BY SUM(total_shares) * 2 + SUM(total_saves) DESC
        """)
    ).fetchall()

    return [
        {"dow": int(r.dow), "hour": int(r.hour_utc), "posts": int(r.posts),
         "shares": int(r.shares), "saves": int(r.saves), "score": int(r.score)}
        for r in rows
    ]