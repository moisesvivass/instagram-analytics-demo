"""
Admin endpoints — CSV import from Meta Business Suite exports.
"""
import asyncio
import csv
import io
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CsvPost, InstagramSnapshot
from app.services.instagram import fetch_audience_insights, fetch_overview, fetch_posts, fetch_reach_by_surface, fetch_reach_chart

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# Map normalised header variants → model field names
_HEADER_MAP: dict[str, str] = {
    "post_id":          "post_id",
    "media_id":         "post_id",
    "account_username": "account_username",
    "description":      "description",
    "duration_(sec)":   "duration_sec",
    "duration_sec":     "duration_sec",
    "publish_time":     "publish_time",
    "permalink":        "permalink",
    "post_type":        "post_type",
    "views":            "views",
    "impressions":      "views",
    "reach":            "reach",
    "likes":            "likes",
    "shares":           "shares",
    "follows":          "follows",
    "comments":         "comments",
    "saves":            "saves",
    "date":             "date",
}

_STORY_TYPES = {"story", "stories"}


def _normalise_header(h: str) -> str:
    return h.strip().lower().replace(" ", "_")


def _parse_int(val: str) -> int:
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0


def _parse_datetime(val: str) -> datetime | None:
    if not val or not val.strip():
        return None
    val = val.strip()
    for fmt in (
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(val)
    except ValueError:
        return None


@router.post("/sync-now")
async def sync_now(db: Session = Depends(get_db)):
    """Manually trigger the scheduled refresh. Temporary — remove after first production verify."""
    try:
        overview, _, _, audience, surface = await asyncio.gather(
            fetch_overview(),
            fetch_posts(db=db),
            fetch_reach_chart(),
            fetch_audience_insights(),
            fetch_reach_by_surface(),
        )
        snapshot = InstagramSnapshot(
            followers=overview.get("followers", 0),
            reach=overview.get("reach_28d", 0),
            impressions=0,
            engaged_accounts=overview.get("accounts_engaged", 0),
            interactions=overview.get("interactions", 0),
            profile_views=overview.get("profile_views", 0),
            target_market_reach_pct=audience.get("target_market_reach_pct"),
            non_follower_reach_pct=None,
            reel_reach_pct=surface.get("reel_reach_pct"),
            captured_at=datetime.utcnow(),
        )
        db.add(snapshot)
        db.commit()
        logger.info("sync-now: snapshot saved id=%d followers=%d", snapshot.id, snapshot.followers)
        return {
            "status": "ok",
            "snapshot_id": snapshot.id,
            "followers": snapshot.followers,
            "reach": snapshot.reach,
            "profile_views": snapshot.profile_views,
            "target_market_reach_pct": snapshot.target_market_reach_pct,
            "reel_reach_pct": snapshot.reel_reach_pct,
            "captured_at": snapshot.captured_at.isoformat(),
        }
    except Exception as exc:
        db.rollback()
        logger.exception("sync-now failed")
        raise HTTPException(status_code=502, detail="Sync failed — check server logs") from exc


@router.post("/import-csv")
async def import_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    raw_bytes = await file.read()
    try:
        content = raw_bytes.decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        content = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(content))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no headers")

    # Build normalised header → field mapping for this specific file
    col_map: dict[str, str] = {}
    for raw_header in reader.fieldnames:
        norm = _normalise_header(raw_header)
        if norm in _HEADER_MAP:
            col_map[raw_header] = _HEADER_MAP[norm]

    if "post_id" not in col_map.values():
        raise HTTPException(
            status_code=400,
            detail="CSV missing required column: Post ID or Media ID",
        )

    # Load existing post_ids once to skip duplicates efficiently
    existing_ids: set[str] = {row.post_id for row in db.query(CsvPost.post_id).all()}

    imported = 0
    skipped = 0
    total_rows = 0

    for row in reader:
        total_rows += 1

        mapped: dict[str, str] = {col_map[k]: v for k, v in row.items() if k in col_map}

        # Filter 1: only "Lifetime" rows
        if mapped.get("date", "").strip().lower() != "lifetime":
            skipped += 1
            continue

        # Filter 2: skip Stories
        post_type = mapped.get("post_type", "").strip()
        if post_type.lower() in _STORY_TYPES:
            skipped += 1
            continue

        post_id = mapped.get("post_id", "").strip()
        if not post_id:
            skipped += 1
            continue

        # Filter 3: skip duplicates
        if post_id in existing_ids:
            skipped += 1
            continue

        db.add(CsvPost(
            post_id=post_id,
            account_username=mapped.get("account_username", "").strip() or None,
            description=mapped.get("description", "").strip() or None,
            duration_sec=_parse_int(mapped.get("duration_sec", "")) or None,
            publish_time=_parse_datetime(mapped.get("publish_time", "")),
            permalink=mapped.get("permalink", "").strip() or None,
            post_type=post_type or None,
            views=_parse_int(mapped.get("views", "")),
            reach=_parse_int(mapped.get("reach", "")),
            likes=_parse_int(mapped.get("likes", "")),
            shares=_parse_int(mapped.get("shares", "")),
            follows=_parse_int(mapped.get("follows", "")),
            comments=_parse_int(mapped.get("comments", "")),
            saves=_parse_int(mapped.get("saves", "")),
            imported_at=datetime.utcnow(),
        ))
        existing_ids.add(post_id)
        imported += 1

    db.commit()
    logger.info("CSV import: imported=%d skipped=%d total=%d", imported, skipped, total_rows)

    return {"imported": imported, "skipped": skipped, "total_rows": total_rows}


@router.get("/snapshots")
async def snapshot_stats(db: Session = Depends(get_db)):
    """Debug: show how many InstagramSnapshot rows exist and what dates they cover."""
    count = db.query(func.count(InstagramSnapshot.id)).scalar() or 0
    oldest = db.query(InstagramSnapshot).order_by(InstagramSnapshot.captured_at.asc()).first()
    newest = db.query(InstagramSnapshot).order_by(InstagramSnapshot.captured_at.desc()).first()
    snap_7d_cutoff = datetime.utcnow()
    snap_7d = (
        db.query(InstagramSnapshot)
        .filter(InstagramSnapshot.captured_at <= snap_7d_cutoff - timedelta(days=7))
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )
    return {
        "total_rows": count,
        "oldest_captured_at": oldest.captured_at.isoformat() if oldest else None,
        "oldest_followers": oldest.followers if oldest else None,
        "newest_captured_at": newest.captured_at.isoformat() if newest else None,
        "newest_followers": newest.followers if newest else None,
        "snapshot_7d_ago_captured_at": snap_7d.captured_at.isoformat() if snap_7d else None,
        "snapshot_7d_ago_followers": snap_7d.followers if snap_7d else None,
        "diagnosis": "EMPTY — snapshots never written" if count == 0 else "OK",
    }
