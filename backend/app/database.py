from functools import lru_cache

from sqlalchemy import create_engine, text, Engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import get_settings
from app.models import Base


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    return create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=1800)


_SessionFactory = None


def init_db() -> None:
    global _SessionFactory
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    # Idempotent migration: add source column to ai_insights if it doesn't exist yet.
    # create_all never adds columns to existing tables, so this handles the upgrade case.
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE ai_insights "
            "ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'mock'"
        ))
        conn.execute(text(
            "ALTER TABLE ai_insights "
            "ADD COLUMN IF NOT EXISTS action_board TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE calendar_posts "
            "ADD COLUMN IF NOT EXISTS opening_script TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE calendar_posts "
            "ADD COLUMN IF NOT EXISTS products_to_mention TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE calendar_posts "
            "ADD COLUMN IF NOT EXISTS hashtags TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE calendar_posts "
            "ADD COLUMN IF NOT EXISTS recommended_duration VARCHAR(20)"
        ))
        # Audience insights columns added to instagram_snapshots (tracker automation)
        conn.execute(text(
            "ALTER TABLE instagram_snapshots "
            "ADD COLUMN IF NOT EXISTS target_market_reach_pct FLOAT"
        ))
        conn.execute(text(
            "ALTER TABLE instagram_snapshots "
            "ADD COLUMN IF NOT EXISTS non_follower_reach_pct FLOAT"
        ))
        conn.execute(text(
            "ALTER TABLE instagram_snapshots "
            "ADD COLUMN IF NOT EXISTS reel_reach_pct FLOAT"
        ))
        # Cached Claude analysis per post
        conn.execute(text(
            "ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_analysis TEXT"
        ))
        # None = no analysis yet; False = early (24-72h); True = final (72h+, never regenerated)
        conn.execute(text(
            "ALTER TABLE posts ADD COLUMN IF NOT EXISTS analysis_is_final BOOLEAN"
        ))
        # HQ Glance cache table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS hq_glance_cache (
                id SERIAL PRIMARY KEY,
                top_post TEXT NOT NULL,
                follower_growth TEXT NOT NULL,
                top_signal TEXT NOT NULL,
                priority_action TEXT NOT NULL,
                generated_at TIMESTAMP NOT NULL,
                daily_refresh_count INTEGER NOT NULL DEFAULT 0,
                daily_refresh_date DATE
            )
        """))
        # Calendar post details rate-limiting timestamp
        conn.execute(text(
            "ALTER TABLE calendar_posts ADD COLUMN IF NOT EXISTS details_generated_at TIMESTAMP"
        ))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_views INTEGER"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS duration_sec INTEGER"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS avg_watch_time_sec FLOAT"))
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_trial_reel BOOLEAN DEFAULT FALSE"))
        conn.commit()
    _SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    if _SessionFactory is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    db: Session = _SessionFactory()
    try:
        yield db
    finally:
        db.close()


def create_session() -> Session:
    """Return a standalone DB session for use outside FastAPI dependency injection.
    Caller is responsible for commit/rollback and close."""
    if _SessionFactory is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    return _SessionFactory()
