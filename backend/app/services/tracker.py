"""
Transition Tracker — all 5 metrics calculated automatically.

Data sources:
  target_market_reach_pct  : instagram_snapshots (fetched via reached_audience_demographics?breakdown=country)
  non_follower_reach_pct   : instagram_snapshots (fetched via reached_audience_demographics?breakdown=follow_type)
  profile_visit_conversion : instagram_snapshots (profile_views / reach * 1000)
  views_rolling_avg        : posts table (avg reach, last 14 posts vs previous 14)
  content_quality_score    : posts table proxy — saves_rate (saves/reach %) last 14 vs previous 14
                             (true skip rate requires video completion data not available via API)
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import InstagramSnapshot, Post
from app.services.mock_data import get_mock_audience_insights, get_mock_posts

logger = logging.getLogger(__name__)

_MOCK_SNAPSHOT_CURRENT = {
    "profile_views": 8_940,
    "reach": 312_800,
    "target_market_reach_pct": 27.5,
    "reel_reach_pct": 74.2,
}
_MOCK_SNAPSHOT_PREV = {
    "profile_views": 8_280,
    "reach": 287_400,
    "target_market_reach_pct": 24.0,
    "reel_reach_pct": 69.8,
}


def _pvc(profile_views: int, reach: int) -> float | None:
    if reach <= 0:
        return None
    return round(profile_views / (reach / 1_000), 2)


def _delta_pct(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _delta_abs(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None:
        return None
    return round(current - previous, 2)


def _metric(current: float | None, previous: float | None, source: str) -> dict:
    return {
        "current": current,
        "previous": previous,
        "delta_abs": _delta_abs(current, previous),
        "delta_pct": _delta_pct(current, previous),
        "source": source,
    }


def _rolling_stats(posts: list) -> tuple[int | None, int | None, float | None, float | None]:
    """Single-pass over ORM post objects → (views_cur, views_prev, quality_cur, quality_prev)."""
    cur14  = posts[:14]
    prev14 = posts[14:] if len(posts) > 14 else []

    cur_reach = cur_saves = 0
    for p in cur14:
        cur_reach += p.reach
        cur_saves += p.saved

    prev_reach = prev_saves = 0
    for p in prev14:
        prev_reach += p.reach
        prev_saves += p.saved

    views_cur  = round(cur_reach  / len(cur14))  if cur14  else None
    views_prev = round(prev_reach / len(prev14)) if prev14 else None
    qual_cur   = round(cur_saves  / cur_reach  * 100, 2) if cur_reach  else None
    qual_prev  = round(prev_saves / prev_reach * 100, 2) if prev_reach else None

    return views_cur, views_prev, qual_cur, qual_prev


def _rolling_stats_mock(posts: list[dict]) -> tuple[int | None, int | None, float | None, float | None]:
    """Same single-pass for in-memory mock dicts."""
    cur_reach = cur_saves = 0
    for p in posts:
        cur_reach += p["reach"]
        cur_saves += p["saved"]

    views_cur = round(cur_reach / len(posts)) if posts else None
    qual_cur  = round(cur_saves / cur_reach * 100, 2) if cur_reach else None
    # Simulate previous window at 88% of current for mock realism
    views_prev = round(views_cur * 0.88) if views_cur else None
    qual_prev  = round(qual_cur  * 0.88, 2) if qual_cur else None

    return views_cur, views_prev, qual_cur, qual_prev


def get_tracker_metrics(db: Session) -> dict:
    settings = get_settings()

    # Snapshots — latest and 7-days-ago for WoW comparison
    snap_latest = (
        db.query(InstagramSnapshot)
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )
    snap_prev = (
        db.query(InstagramSnapshot)
        .filter(InstagramSnapshot.captured_at <= datetime.utcnow() - timedelta(days=7))
        .order_by(InstagramSnapshot.captured_at.desc())
        .first()
    )

    def _snap_val(snap, attr: str) -> float | None:
        return getattr(snap, attr, None) if snap else None

    if snap_latest:
        tmr_cur  = _snap_val(snap_latest, "target_market_reach_pct")
        tmr_prev = _snap_val(snap_prev,   "target_market_reach_pct")
        rrl_cur  = _snap_val(snap_latest, "reel_reach_pct")
        rrl_prev = _snap_val(snap_prev,   "reel_reach_pct")
        pvc_cur  = _pvc(snap_latest.profile_views, snap_latest.reach)
        pvc_prev = _pvc(snap_prev.profile_views, snap_prev.reach) if snap_prev else None
    elif settings.use_mock_data:
        mock_ai  = get_mock_audience_insights()
        tmr_cur  = mock_ai["target_market_reach_pct"]
        tmr_prev = _MOCK_SNAPSHOT_PREV["target_market_reach_pct"]
        rrl_cur  = mock_ai["reel_reach_pct"]
        rrl_prev = _MOCK_SNAPSHOT_PREV["reel_reach_pct"]
        pvc_cur  = _pvc(_MOCK_SNAPSHOT_CURRENT["profile_views"], _MOCK_SNAPSHOT_CURRENT["reach"])
        pvc_prev = _pvc(_MOCK_SNAPSHOT_PREV["profile_views"],    _MOCK_SNAPSHOT_PREV["reach"])
    else:
        tmr_cur = tmr_prev = rrl_cur = rrl_prev = pvc_cur = pvc_prev = None

    # Posts — rolling avg + quality score
    db_posts = (
        db.query(Post)
        .order_by(Post.timestamp.desc())
        .limit(28)
        .all()
    )

    if len(db_posts) >= 14:
        views_cur, views_prev, quality_cur, quality_prev = _rolling_stats(db_posts)
    elif settings.use_mock_data:
        mock_posts = sorted(get_mock_posts(), key=lambda p: p["timestamp"], reverse=True)
        views_cur, views_prev, quality_cur, quality_prev = _rolling_stats_mock(mock_posts)
    else:
        views_cur = views_prev = quality_cur = quality_prev = None

    return {
        "target_market_reach":      _metric(tmr_cur,     tmr_prev,     "calculated"),
        "reel_reach":               _metric(rrl_cur,     rrl_prev,     "calculated"),
        "profile_visit_conversion": _metric(pvc_cur,     pvc_prev,     "calculated"),
        "views_rolling_avg":        _metric(views_cur,   views_prev,   "calculated"),
        "content_quality_score":    _metric(quality_cur, quality_prev, "calculated"),
        "updated_at": datetime.utcnow().isoformat(),
    }
