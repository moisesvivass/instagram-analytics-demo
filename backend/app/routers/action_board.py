import json
import logging
import traceback
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from app.limiter import limiter
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import ActionBoardCache, CsvPost
from app.services.action_board import generate_action_board
from app.services.instagram import fetch_posts
from app.services.mock_data import get_mock_action_board
from app.utils import next_monday_iso, week_start_utc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/action-board", tags=["action-board"])


# ─── Rate-limit helpers ───────────────────────────────────────────────────────

def _weekly_real_count(db: Session) -> int:
    return (
        db.query(ActionBoardCache)
        .filter(ActionBoardCache.source == "real", ActionBoardCache.generated_at >= week_start_utc())
        .count()
    )


# ─── Post merge helpers ───────────────────────────────────────────────────────

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


# ─── Cache serialisation ──────────────────────────────────────────────────────

def _cache_to_dict(record: ActionBoardCache, calls_used: int) -> dict:
    try:
        items = json.loads(record.items)
    except Exception:
        items = []
    return {
        "weekly_plan":  items,
        "generated_at": record.generated_at.isoformat(),
        "source":       record.source,
        "calls_used":   calls_used,
        "calls_max":    3,
    }


def _get_history(db: Session) -> list[dict]:
    """Return the last 2 real ActionBoard plans (oldest first) for memory context."""
    rows = (
        db.query(ActionBoardCache)
        .filter(ActionBoardCache.source == "real")
        .order_by(ActionBoardCache.generated_at.desc())
        .limit(2)
        .all()
    )
    history = []
    for row in reversed(rows):  # oldest first so labels read "two weeks ago → last week"
        try:
            history.append({
                "generated_at": row.generated_at.isoformat(),
                "weekly_plan":  json.loads(row.items),
            })
        except json.JSONDecodeError:
            pass
    return history


async def _build_and_save(db: Session, count_before: int) -> dict:
    """Call Claude, persist result, return serialised dict with updated count."""
    api_posts = await fetch_posts(db=db)
    all_posts = _get_merged_posts(api_posts, db)
    history   = _get_history(db)
    result    = await generate_action_board(all_posts, history=history)

    record = ActionBoardCache(
        items=json.dumps(result.get("weekly_plan", [])),
        generated_at=datetime.utcnow(),
        source="real",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return _cache_to_dict(record, count_before + 1)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def get_action_board(db: Session = Depends(get_db)):
    settings = get_settings()
    try:
        if settings.use_mock_data:
            return get_mock_action_board()

        count      = _weekly_real_count(db)
        cutoff_48h = datetime.utcnow() - timedelta(hours=48)
        recent = (
            db.query(ActionBoardCache)
            .filter(ActionBoardCache.source == "real", ActionBoardCache.generated_at >= cutoff_48h)
            .order_by(ActionBoardCache.generated_at.desc())
            .first()
        )
        if recent:
            return JSONResponse(
                content=_cache_to_dict(recent, count),
                headers={"X-Cache": "hit"},
            )

        if count >= 3:
            stale = (
                db.query(ActionBoardCache)
                .filter(ActionBoardCache.source == "real")
                .order_by(ActionBoardCache.generated_at.desc())
                .first()
            )
            if stale:
                return JSONResponse(
                    content=_cache_to_dict(stale, count),
                    headers={"X-Cache": "stale"},
                )
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Weekly limit reached",
                    "calls_used": count,
                    "calls_max": 3,
                    "resets_at": next_monday_iso(),
                },
            )

        return await _build_and_save(db, count)
    except Exception as exc:
        logger.error("get_action_board failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=502, detail="Failed to generate action board") from exc


@router.post("/generate")
@limiter.limit("10/hour")
async def force_generate(request: Request, db: Session = Depends(get_db)):
    """Bypass the 48 h cache and generate a fresh action board.
    Still enforces the weekly 3-call limit."""
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
            return get_mock_action_board()

        count = _weekly_real_count(db)
        return await _build_and_save(db, count)
    except Exception as exc:
        logger.error("force_generate_action_board failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=502, detail="Failed to generate action board") from exc
