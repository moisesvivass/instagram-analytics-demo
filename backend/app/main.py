import asyncio
import base64
import logging
import secrets
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from dotenv import load_dotenv
load_dotenv()

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.database import create_session, init_db
from app.limiter import limiter
from app.models import InstagramSnapshot
from app.routers import action_board, admin, calendar, headlines, insights, instagram, posts, refresh, spark, tracker
from app.services.instagram import fetch_audience_insights, fetch_overview, fetch_posts, fetch_reach_chart, fetch_reach_by_surface, fetch_token_info

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

_WWW_AUTH = {"WWW-Authenticate": 'Basic realm="Instagram Analytics Demo"'}

_AUTH_WINDOW    = timedelta(minutes=10)
_AUTH_BLOCK     = timedelta(minutes=10)
_MAX_FAILURES   = 15

# { ip: {"count": int, "window_start": datetime, "blocked_until": datetime | None} }
_auth_failures: dict[str, dict] = {}
_failures_lock  = threading.Lock()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _is_ip_blocked(ip: str) -> bool:
    with _failures_lock:
        entry = _auth_failures.get(ip)
        return bool(entry and entry["blocked_until"] and datetime.utcnow() < entry["blocked_until"])


def _record_auth_failure(ip: str) -> bool:
    """Record a failed attempt. Returns True if the IP should now be blocked."""
    now = datetime.utcnow()
    with _failures_lock:
        entry = _auth_failures.get(ip)

        if entry is None:
            _auth_failures[ip] = {"count": 1, "window_start": now, "blocked_until": None}
            return False

        # Already blocked — keep blocking
        if entry["blocked_until"] and now < entry["blocked_until"]:
            return True

        # Window expired — start a fresh window
        if now - entry["window_start"] > _AUTH_WINDOW:
            _auth_failures[ip] = {"count": 1, "window_start": now, "blocked_until": None}
            return False

        entry["count"] += 1
        if entry["count"] >= _MAX_FAILURES:
            entry["blocked_until"] = now + _AUTH_BLOCK
            logger.warning("Auth block: %s — %d failures, blocked for %d min", ip, entry["count"], _AUTH_BLOCK.seconds // 60)
            return True

        return False


def _clear_auth_failures(ip: str) -> None:
    with _failures_lock:
        _auth_failures.pop(ip, None)


def _unauthorized() -> Response:
    return Response(status_code=401, headers=_WWW_AUTH)


def _too_many_requests() -> Response:
    return Response(
        status_code=429,
        content="Too Many Requests",
        headers={"Retry-After": str(int(_AUTH_BLOCK.total_seconds()))},
    )


async def _scheduled_token_check() -> None:
    """Weekly job: log Instagram token expiry. Warns at 30 days, critical at 15."""
    settings = get_settings()
    if settings.use_mock_data:
        return
    try:
        info = await fetch_token_info()
        days = info.get("days_remaining")
        status = info.get("status")
        if status == "critical":
            logger.critical("INSTAGRAM TOKEN EXPIRES IN %s DAYS — renew immediately at developers.facebook.com", days)
        elif status == "warning":
            logger.warning("Instagram token expires in %s days — renew soon at developers.facebook.com", days)
        else:
            logger.info("Instagram token OK — %s days remaining", days)
    except Exception:
        logger.exception("Token check failed")


async def _scheduled_refresh() -> None:
    logger.info("Scheduled refresh started at %s", datetime.utcnow().isoformat())
    db = create_session()
    try:
        overview, _, _, audience, surface = await asyncio.gather(
            fetch_overview(),
            fetch_posts(db=db),
            fetch_reach_chart(),
            fetch_audience_insights(),
            fetch_reach_by_surface(),
        )
        try:
            snapshot = InstagramSnapshot(
                followers=overview.get("followers", 0),
                reach=overview.get("reach_28d", 0),
                impressions=0,
                engaged_accounts=overview.get("accounts_engaged", 0),
                interactions=overview.get("interactions", 0),
                profile_views=overview.get("profile_views", 0),
                target_market_reach_pct=audience.get("target_market_reach_pct"),
                non_follower_reach_pct=audience.get("non_follower_reach_pct"),
                reel_reach_pct=surface.get("reel_reach_pct"),
                captured_at=datetime.utcnow(),
            )
            db.add(snapshot)
            db.commit()
            logger.info(
                "Snapshot saved: followers=%d reach=%d target_market=%.1f%% non_follower=%.1f%%",
                snapshot.followers, snapshot.reach,
                snapshot.target_market_reach_pct or 0,
                snapshot.non_follower_reach_pct or 0,
            )
        except Exception:
            db.rollback()
            logger.exception("Failed to save snapshot")
        logger.info("Scheduled refresh completed successfully")
    except Exception:
        logger.exception("Scheduled refresh failed")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()  # raises if env vars are missing
    init_db()
    logger.info("Database initialized. ENVIRONMENT=%s USE_MOCK_DATA=%s", settings.environment, settings.use_mock_data)

    scheduler.add_job(_scheduled_refresh, "cron", hour=12, minute=0, id="refresh_job")
    scheduler.add_job(_scheduled_token_check, "cron", day_of_week="mon", hour=9, minute=0, id="token_check_job")
    scheduler.start()
    logger.info("Scheduler started — daily refresh at 12:00 UTC, token check every Monday at 09:00 UTC")

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Instagram Analytics Demo",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.allowed_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def basic_auth_middleware(request: Request, call_next):
    if request.url.path == "/api/health" or request.method == "OPTIONS":
        return await call_next(request)

    ip = _get_client_ip(request)

    if _is_ip_blocked(ip):
        return _too_many_requests()

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Basic "):
        return _unauthorized()  # No credentials at all — don't count as failure

    try:
        decoded = base64.b64decode(auth[6:]).decode("utf-8")
        username, _, password = decoded.partition(":")
    except Exception:
        if _record_auth_failure(ip):
            return _too_many_requests()
        return _unauthorized()

    cfg = get_settings()
    if not (
        secrets.compare_digest(username, cfg.basic_auth_user)
        and secrets.compare_digest(password, cfg.basic_auth_password)
    ):
        if _record_auth_failure(ip):
            return _too_many_requests()
        return _unauthorized()

    _clear_auth_failures(ip)
    return await call_next(request)


app.include_router(instagram.router)
app.include_router(insights.router)
app.include_router(action_board.router)
app.include_router(posts.router)
app.include_router(calendar.router)
app.include_router(headlines.router)
app.include_router(refresh.router)
app.include_router(admin.router)
app.include_router(tracker.router)
app.include_router(spark.router)


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
