"""
Instagram Graph API v21.0 service.
When USE_MOCK_DATA=true, returns realistic mock data for @creator_demo.
When USE_MOCK_DATA=false, calls the real Instagram Graph API.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.config import get_settings
from app.services.mock_data import (
    _truncate_caption,
    get_mock_audience_insights,
    get_mock_comments,
    get_mock_growth,
    get_mock_overview,
    get_mock_posts,
    get_mock_reach_chart,
    get_mock_reach_sources,
)

GRAPH_BASE = "https://graph.facebook.com/v21.0"
logger = logging.getLogger(__name__)


def _headers() -> dict:
    settings = get_settings()
    return {"Authorization": f"Bearer {settings.instagram_access_token}"}


def _raise_with_log(response: httpx.Response) -> None:
    """Log the full Meta API error body before raising, so we can debug 400s."""
    if response.is_error:
        logger.error(
            "Instagram API error | status=%s | url=%s | body=%s",
            response.status_code,
            str(response.url),
            response.text,
        )
        response.raise_for_status()


def _parse_insights(data_list: list[dict]) -> dict:
    """
    Convert the insights data array into a flat {metric_name: value} dict.

    Handles two response shapes:
    - Standard:     {"name": "reach",         "values": [{"value": 1234}]}
    - total_value:  {"name": "profile_views",  "total_value": {"value": 567}}
    """
    result: dict = {}
    for item in data_list:
        name = item.get("name")
        if not name:
            continue
        if "total_value" in item:
            result[name] = item["total_value"].get("value", 0)
        else:
            values = item.get("values", [])
            if values:
                result[name] = values[-1].get("value", 0)
    return result


def _unix_days_ago(days: int) -> int:
    return int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())


async def _fetch_insights_values(metric: str, days: int) -> list[dict]:
    """Fetch daily insight metric values for the past N days; returns the values list."""
    settings = get_settings()
    account_id = settings.instagram_business_account_id
    # follower_count (singular) and other metrics use `metric` param; since/until need Unix timestamps
    params = {
        "metric": metric,
        "period": "day",
        "since": _unix_days_ago(days),
        "until": _unix_days_ago(0),
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{GRAPH_BASE}/{account_id}/insights",
            headers=_headers(),
            params=params,
            timeout=10.0,
        )
        _raise_with_log(r)
        data_list = r.json().get("data", [])
    return data_list[0].get("values", []) if data_list else []


async def fetch_overview() -> dict:
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_overview()

    account_id = settings.instagram_business_account_id
    # accounts_engaged, total_interactions, and profile_views are all incompatible
    # with period=days_28 — fetch daily with since/until and sum to get 28-day totals
    daily_params = {
        "period": "day",
        "metric_type": "total_value",
        "since": _unix_days_ago(28),
        "until": _unix_days_ago(0),
    }
    try:
        async with httpx.AsyncClient() as client:
            # followers_count is a field on the IG User node, NOT an insights metric
            r_profile, r_reach, r_daily = await asyncio.gather(
                client.get(
                    f"{GRAPH_BASE}/{account_id}",
                    headers=_headers(),
                    params={"fields": "followers_count"},
                    timeout=10.0,
                ),
                client.get(
                    f"{GRAPH_BASE}/{account_id}/insights",
                    headers=_headers(),
                    params={"metric": "reach", "period": "days_28"},
                    timeout=10.0,
                ),
                client.get(
                    f"{GRAPH_BASE}/{account_id}/insights",
                    headers=_headers(),
                    params={
                        "metric": "profile_views,accounts_engaged,total_interactions",
                        **daily_params,
                    },
                    timeout=10.0,
                ),
            )
        _raise_with_log(r_profile)
        _raise_with_log(r_reach)
        _raise_with_log(r_daily)

        profile = r_profile.json()
        reach_metrics = _parse_insights(r_reach.json().get("data", []))
        # metric_type=total_value returns data in the total_value key, not values[]
        daily_totals = _parse_insights(r_daily.json().get("data", []))

        return {
            "followers": profile.get("followers_count", 0),
            "reach_28d": reach_metrics.get("reach", 0),
            "profile_views": daily_totals.get("profile_views", 0),
            "accounts_engaged": daily_totals.get("accounts_engaged", 0),
            "interactions": daily_totals.get("total_interactions", 0),
            "last_refreshed": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.error("fetch_overview failed: %s", exc)
        return {"followers": 0, "reach_28d": 0, "profile_views": 0, "accounts_engaged": 0, "interactions": 0, "last_refreshed": datetime.now(timezone.utc).isoformat()}


async def fetch_growth() -> list[dict]:
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_growth()

    try:
        return await _fetch_insights_values("follower_count", 28)
    except Exception as exc:
        logger.error("fetch_growth failed: %s", exc)
        return []


async def _refresh_expired_thumbnails(
    posts: list[dict],
    freshly_synced_ids: set[str],
    db,
) -> None:
    """
    HEAD-check thumbnail URLs for posts not just synced from the Instagram API.
    If a URL returns 4xx (expired), fetch a fresh one from the Instagram API and
    update both the post dict in-place and the DB record.
    Runs all checks concurrently (semaphore of 10 to respect rate limits).
    """
    from app.models import Post as PostModel

    candidates = [
        p for p in posts
        if p["post_id"] not in freshly_synced_ids and p.get("thumbnail_url")
    ]
    if not candidates:
        return

    sem = asyncio.Semaphore(10)
    refreshed: list[str] = []

    async def _check(post: dict, client: httpx.AsyncClient) -> None:
        async with sem:
            try:
                head = await client.head(
                    post["thumbnail_url"], timeout=5.0, follow_redirects=True
                )
                if head.status_code < 400:
                    return  # still valid

                # Expired — fetch fresh URL
                fresh = await client.get(
                    f"{GRAPH_BASE}/{post['post_id']}",
                    headers=_headers(),
                    params={"fields": "media_url,thumbnail_url"},
                    timeout=10.0,
                )
                if fresh.is_error:
                    logger.warning(
                        "Could not refresh thumbnail for %s: status=%s",
                        post["post_id"], fresh.status_code,
                    )
                    return

                data = fresh.json()
                new_url = data.get("thumbnail_url") or data.get("media_url", "")
                if not new_url:
                    return

                post["thumbnail_url"] = new_url
                refreshed.append(post["post_id"])

                row = db.query(PostModel).filter(PostModel.post_id == post["post_id"]).first()
                if row:
                    row.thumbnail_url = new_url

            except Exception as exc:
                logger.warning("Thumbnail HEAD check failed for %s: %s", post["post_id"], exc)

    async with httpx.AsyncClient() as client:
        await asyncio.gather(*[_check(p, client) for p in candidates])

    if refreshed:
        try:
            db.commit()
            logger.info("Refreshed expired thumbnails for %d posts: %s", len(refreshed), refreshed)
        except Exception:
            db.rollback()


async def fetch_posts(db=None) -> list[dict]:
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_posts()

    account_id = settings.instagram_business_account_id
    _fields_base = (
        "id,caption,media_type,timestamp,"
        "like_count,comments_count,"
        "thumbnail_url,media_url,video_length,"
        "insights.metric(reach,saved,shares,video_views,impressions)"
    )
    _fields_with_watch_time = _fields_base.replace(
        "impressions)", "impressions,ig_reels_avg_watch_time)"
    )

    # Load known post_ids to enable upsert (update existing, insert new)
    known_post_ids: set[str] = set()
    if db is not None:
        from app.models import Post
        known_post_ids = {row.post_id for row in db.query(Post.post_id).all()}

    all_items: list[dict] = []
    cursor: str | None = None
    TARGET = 20
    # Some accounts have non-VIDEO posts that cause ig_reels_avg_watch_time to 400.
    # Start with watch time; fall back to base fields if the first page errors.
    active_fields = _fields_with_watch_time

    try:
        async with httpx.AsyncClient() as client:
            while len(all_items) < TARGET:
                params: dict = {"fields": active_fields, "limit": 20}
                if cursor:
                    params["after"] = cursor

                r = await client.get(
                    f"{GRAPH_BASE}/{account_id}/media",
                    headers=_headers(),
                    params=params,
                    timeout=15.0,
                )
                if r.status_code == 400 and active_fields == _fields_with_watch_time:
                    logger.warning("ig_reels_avg_watch_time caused 400 — retrying without it")
                    active_fields = _fields_base
                    continue
                _raise_with_log(r)
                data = r.json()
                items = data.get("data", [])

                if not items:
                    break

                all_items.extend(items)
                if len(all_items) >= TARGET:
                    break

                paging = data.get("paging", {})
                cursor = paging.get("cursors", {}).get("after")
                if not cursor or "next" not in paging:
                    break

        # Build post dicts from API results
        posts_to_upsert: list[dict] = []
        for item in all_items[:TARGET]:
            insights = _parse_insights(item.get("insights", {}).get("data", []))
            reach = insights.get("reach", 0)
            likes = item.get("like_count", 0)
            comments = item.get("comments_count", 0)
            thumbnail = item.get("thumbnail_url") or item.get("media_url", "")
            media_type = item.get("media_type", "IMAGE")
            raw_views = insights.get("video_views")
            raw_watch_ms = insights.get("ig_reels_avg_watch_time")
            raw_duration = item.get("video_length")
            is_reel = media_type in ("REEL", "VIDEO")
            video_views = int(raw_views) if raw_views is not None and is_reel else None
            duration_sec = int(raw_duration) if raw_duration is not None else None
            avg_watch_time_sec = round(float(raw_watch_ms) / 1000, 2) if raw_watch_ms and is_reel else None
            posts_to_upsert.append({
                "post_id": item["id"],
                "caption": item.get("caption", ""),
                "media_type": media_type,
                "timestamp": item.get("timestamp", ""),
                "like_count": likes,
                "comments_count": comments,
                "reach": reach,
                "saved": insights.get("saved", 0),
                "shares": insights.get("shares", 0),
                "engagement_rate": round((likes + comments) / reach, 4) if reach else 0.0,
                "thumbnail_url": thumbnail,
                "video_views": video_views,
                "duration_sec": duration_sec,
                "avg_watch_time_sec": avg_watch_time_sec,
                "impressions": int(insights["impressions"]) if "impressions" in insights else None,
            })

        # Track which post IDs were just refreshed from the API
        freshly_synced_ids = {p["post_id"] for p in posts_to_upsert}

        # Upsert: insert new posts, update existing ones (metrics + thumbnail)
        if db is not None and posts_to_upsert:
            from app.models import Post
            # Batch-fetch all existing posts in one query to avoid N+1
            upsert_ids = [p["post_id"] for p in posts_to_upsert if p["post_id"] in known_post_ids]
            existing_by_id = {
                row.post_id: row
                for row in db.query(Post).filter(Post.post_id.in_(upsert_ids)).all()
            }
            inserted = 0
            updated = 0
            for p in posts_to_upsert:
                ts = datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00"))
                if p["post_id"] in known_post_ids:
                    existing = existing_by_id.get(p["post_id"])
                    if existing:
                        existing.like_count = p["like_count"]
                        existing.comments_count = p["comments_count"]
                        existing.reach = p["reach"]
                        existing.saved = p["saved"]
                        existing.shares = p["shares"]
                        existing.engagement_rate = p["engagement_rate"]
                        if p["thumbnail_url"]:
                            existing.thumbnail_url = p["thumbnail_url"]
                        if p["video_views"] is not None:
                            existing.video_views = p["video_views"]
                        if p["duration_sec"] is not None:
                            existing.duration_sec = p["duration_sec"]
                        if p["avg_watch_time_sec"] is not None:
                            existing.avg_watch_time_sec = p["avg_watch_time_sec"]
                        updated += 1
                else:
                    db.add(Post(
                        post_id=p["post_id"],
                        caption=p["caption"],
                        media_type=p["media_type"],
                        timestamp=ts,
                        like_count=p["like_count"],
                        comments_count=p["comments_count"],
                        reach=p["reach"],
                        saved=p["saved"],
                        shares=p["shares"],
                        engagement_rate=p["engagement_rate"],
                        thumbnail_url=p["thumbnail_url"],
                        video_views=p["video_views"],
                        duration_sec=p["duration_sec"],
                        avg_watch_time_sec=p["avg_watch_time_sec"],
                        is_trial_reel=False,
                    ))
                    inserted += 1
            db.commit()
            logger.info("Posts upserted: %d inserted, %d updated", inserted, updated)

        # Return from DB (up to 60 most recent) when a session is available
        if db is not None:
            from app.models import Post
            from sqlalchemy import desc
            stored = (
                db.query(Post)
                .order_by(desc(Post.timestamp))
                .limit(60)
                .all()
            )
            result = [
                {
                    "post_id": p.post_id,
                    "caption": p.caption or "",
                    "media_type": p.media_type,
                    "timestamp": p.timestamp.isoformat(),
                    "like_count": p.like_count,
                    "comments_count": p.comments_count,
                    "reach": p.reach,
                    "saved": p.saved,
                    "shares": p.shares,
                    "engagement_rate": p.engagement_rate,
                    "thumbnail_url": p.thumbnail_url or "",
                    "video_views": p.video_views,
                    "duration_sec": p.duration_sec,
                    "avg_watch_time_sec": p.avg_watch_time_sec,
                    "is_trial_reel": p.is_trial_reel or False,
                    "ai_analysis": p.ai_analysis,
                    "analysis_is_final": p.analysis_is_final,
                }
                for p in stored
            ]
            # Lazy thumbnail refresh: HEAD-check posts not just synced, refresh expired ones
            await _refresh_expired_thumbnails(result, freshly_synced_ids, db)
            return result

        return posts_to_upsert

    except Exception as exc:
        logger.error("fetch_posts failed: %s", exc)
        return []


async def fetch_comments() -> list[dict]:
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_comments()

    account_id = settings.instagram_business_account_id
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{GRAPH_BASE}/{account_id}/media",
                headers=_headers(),
                params={"fields": "id,caption,timestamp", "limit": 10},
                timeout=10.0,
            )
            _raise_with_log(r)
            posts = r.json().get("data", [])

            async def _fetch_post_comments(post: dict) -> list[dict]:
                resp = await client.get(
                    f"{GRAPH_BASE}/{post['id']}/comments",
                    headers=_headers(),
                    params={"fields": "id,username,text,timestamp,like_count", "limit": 5},
                    timeout=10.0,
                )
                if not resp.is_success:
                    logger.warning(
                        "Failed to fetch comments for post %s | status=%s | body=%s",
                        post["id"],
                        resp.status_code,
                        resp.text,
                    )
                    return []
                caption = post.get("caption", "")
                return [
                    {
                        "comment_id": c["id"],
                        "username": c.get("username", ""),
                        "text": c.get("text", ""),
                        "timestamp": c.get("timestamp", ""),
                        "post_id": post["id"],
                        "post_caption": _truncate_caption(caption),
                        "like_count": c.get("like_count", 0),
                    }
                    for c in resp.json().get("data", [])
                ]

            results = await asyncio.gather(*[_fetch_post_comments(p) for p in posts])

        all_comments = [c for batch in results for c in batch]
        all_comments.sort(key=lambda c: c["timestamp"], reverse=True)
        return all_comments[:10]
    except Exception as exc:
        logger.error("fetch_comments failed: %s", exc)
        return []


async def fetch_audience_insights() -> dict:
    """
    Fetch two account-level audience metrics for the past 28 days:
      target_market_reach_pct : % of reached accounts from US or Canada
      non_follower_reach_pct  : % of reached accounts who don't follow the account

    Both use reached_audience_demographics with different breakdowns.
    Results are stored in instagram_snapshots by the scheduled refresh.
    """
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_audience_insights()

    account_id = settings.instagram_business_account_id
    # reached_audience_demographics (v20+): period=lifetime + timeframe=this_month
    # Valid timeframe values: last_90_days, this_week, prev_month, this_month, last_14_days
    base_params = {
        "period": "lifetime",
        "timeframe": "this_month",
        "metric_type": "total_value",
    }

    target_market_pct: float | None = None
    non_follower_pct:  float | None = None

    try:
        async with httpx.AsyncClient() as client:
            r_country, r_follow = await asyncio.gather(
                client.get(
                    f"{GRAPH_BASE}/{account_id}/insights",
                    headers=_headers(),
                    params={"metric": "reached_audience_demographics", "breakdown": "country", **base_params},
                    timeout=15.0,
                ),
                client.get(
                    f"{GRAPH_BASE}/{account_id}/insights",
                    headers=_headers(),
                    params={"metric": "reached_audience_demographics", "breakdown": "follow_type", **base_params},
                    timeout=15.0,
                ),
            )

        # Country breakdown → US + CA share
        if not r_country.is_error:
            data = r_country.json().get("data", [])
            if data:
                results = (
                    data[0]
                    .get("total_value", {})
                    .get("breakdowns", [{}])[0]
                    .get("results", [])
                )
                total = sum(r.get("value", 0) for r in results)
                us_ca = sum(
                    r.get("value", 0) for r in results
                    if r.get("dimension_values", [""])[0] in ("US", "CA")
                )
                if total > 0:
                    target_market_pct = round(us_ca / total * 100, 1)
        else:
            logger.warning("audience country breakdown failed: %s %s", r_country.status_code, r_country.text[:200])

        # Follow-type breakdown → NON_FOLLOWER share
        if not r_follow.is_error:
            data = r_follow.json().get("data", [])
            if data:
                results = (
                    data[0]
                    .get("total_value", {})
                    .get("breakdowns", [{}])[0]
                    .get("results", [])
                )
                total = sum(r.get("value", 0) for r in results)
                non_followers = sum(
                    r.get("value", 0) for r in results
                    if "NON_FOLLOWER" in r.get("dimension_values", [])
                )
                if total > 0:
                    non_follower_pct = round(non_followers / total * 100, 1)
        else:
            logger.warning("audience follow_type breakdown failed: %s %s", r_follow.status_code, r_follow.text[:200])

    except Exception as exc:
        logger.error("fetch_audience_insights failed: %s", exc)

    return {
        "target_market_reach_pct": target_market_pct,
        "non_follower_reach_pct":  non_follower_pct,
    }


async def fetch_reach_by_surface() -> dict:
    """
    Fetch 28-day reach broken down by surface (REEL, STORY, CAROUSEL_CONTAINER).
    Returns reel_reach_pct for snapshot storage + raw counts for chart display.
    """
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_reach_sources()

    account_id = settings.instagram_business_account_id
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{GRAPH_BASE}/{account_id}/insights",
                headers=_headers(),
                params={
                    "metric": "reach",
                    "breakdown": "media_product_type",
                    "period": "day",
                    "metric_type": "total_value",
                    "since": _unix_days_ago(28),
                    "until": _unix_days_ago(0),
                },
                timeout=15.0,
            )
        _raise_with_log(r)
        data = r.json().get("data", [])
        if not data:
            return {"reel_reach_pct": None, "reel": 0, "story": 0, "carousel": 0, "total": 0}

        results = (
            data[0]
            .get("total_value", {})
            .get("breakdowns", [{}])[0]
            .get("results", [])
        )
        surface_map: dict[str, int] = {"REEL": 0, "STORY": 0, "CAROUSEL_CONTAINER": 0}
        for item in results:
            key = item.get("dimension_values", [""])[0]
            if key in surface_map:
                surface_map[key] = item.get("value", 0)

        total = sum(surface_map.values())
        reel  = surface_map["REEL"]
        reel_pct = round(reel / total * 100, 1) if total > 0 else None

        return {
            "reel_reach_pct": reel_pct,
            "reel":     reel,
            "story":    surface_map["STORY"],
            "carousel": surface_map["CAROUSEL_CONTAINER"],
            "total":    total,
        }
    except Exception as exc:
        logger.error("fetch_reach_by_surface failed: %s", exc)
        return {"reel_reach_pct": None, "reel": 0, "story": 0, "carousel": 0, "total": 0}


async def fetch_reach_chart() -> list[dict]:
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_reach_chart()

    try:
        values = await _fetch_insights_values("reach", 28)
        # real API returns {end_time, value}; frontend chart expects {date, reach}
        return [{"date": v.get("end_time", ""), "reach": v.get("value", 0)} for v in values]
    except Exception as exc:
        logger.error("fetch_reach_chart failed: %s", exc)
        return []


async def fetch_token_info() -> dict:
    """
    Query the Graph API debug_token endpoint to get the access token's expiry date.
    Returns: { days_remaining, expires_at (ISO string), status: "ok"|"warning"|"critical" }
    - ok:       > 30 days remaining
    - warning:  15-30 days remaining
    - critical: < 15 days remaining
    """
    settings = get_settings()

    if settings.use_mock_data:
        # Return a mock token that expires in 45 days so the banner stays green in demo
        mock_expires = datetime.now(timezone.utc) + timedelta(days=45)
        return {
            "days_remaining": 45,
            "expires_at": mock_expires.isoformat(),
            "status": "ok",
        }

    try:
        token = settings.instagram_access_token
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{GRAPH_BASE}/debug_token",
                params={"input_token": token, "access_token": token},
                timeout=10.0,
            )
            _raise_with_log(r)
            data = r.json().get("data", {})

        expires_at_ts = data.get("data_access_expires_at") or data.get("expires_at")
        if not expires_at_ts:
            # Long-lived tokens that never expire return is_valid=True but no expiry
            return {"days_remaining": 999, "expires_at": None, "status": "ok"}

        expires_dt = datetime.fromtimestamp(int(expires_at_ts), tz=timezone.utc)
        days_remaining = (expires_dt - datetime.now(timezone.utc)).days

        if days_remaining > 30:
            status = "ok"
        elif days_remaining >= 15:
            status = "warning"
        else:
            status = "critical"

        return {
            "days_remaining": days_remaining,
            "expires_at": expires_dt.isoformat(),
            "status": status,
        }
    except Exception as exc:
        logger.error("fetch_token_info failed: %s", exc)
        return {"days_remaining": None, "expires_at": None, "status": "unknown"}
