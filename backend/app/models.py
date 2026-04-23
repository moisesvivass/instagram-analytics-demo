from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class InstagramSnapshot(Base):
    __tablename__ = "instagram_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    followers = Column(Integer, nullable=False)
    reach = Column(Integer, nullable=False)
    impressions = Column(Integer, nullable=False)
    engaged_accounts = Column(Integer, nullable=False)
    interactions = Column(Integer, nullable=False)
    profile_views = Column(Integer, nullable=False)
    # Audience insights — fetched separately during scheduled refresh
    target_market_reach_pct = Column(Float, nullable=True)   # % of reach from US + CA (this_month)
    non_follower_reach_pct  = Column(Float, nullable=True)   # kept for backward compat — always null
    reel_reach_pct          = Column(Float, nullable=True)   # % of 28d reach that came from Reels
    captured_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(String(64), unique=True, nullable=False, index=True)
    caption = Column(Text, nullable=True)
    media_type = Column(String(20), nullable=False)  # REEL, CAROUSEL_ALBUM, IMAGE
    timestamp = Column(DateTime, nullable=False)
    like_count = Column(Integer, nullable=False, default=0)
    comments_count = Column(Integer, nullable=False, default=0)
    reach = Column(Integer, nullable=False, default=0)
    saved = Column(Integer, nullable=False, default=0)
    shares = Column(Integer, nullable=False, default=0)
    engagement_rate = Column(Float, nullable=False, default=0.0)
    thumbnail_url = Column(Text, nullable=True)
    video_views        = Column(Integer, nullable=True)
    duration_sec       = Column(Integer, nullable=True)
    avg_watch_time_sec = Column(Float, nullable=True)
    is_trial_reel      = Column(Boolean, nullable=False, default=False)
    ai_analysis        = Column(Text, nullable=True)
    analysis_is_final  = Column(Boolean, nullable=True)


class AiInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True, index=True)
    what_working = Column(Text, nullable=False)
    what_flopping = Column(Text, nullable=False)
    briefing = Column(Text, nullable=False)
    action_board = Column(Text, nullable=True)  # JSON array of action strings
    generated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    # 'mock' = generated while USE_MOCK_DATA=true; 'real' = generated from live Instagram data
    source = Column(String(10), nullable=False, server_default="mock")


class CsvPost(Base):
    __tablename__ = "csv_posts"

    post_id          = Column(String(64), primary_key=True)
    account_username = Column(String(100), nullable=True)
    description      = Column(Text, nullable=True)
    duration_sec     = Column(Integer, nullable=True)
    publish_time     = Column(DateTime, nullable=True)
    permalink        = Column(Text, nullable=True)
    post_type        = Column(String(30), nullable=True)
    views            = Column(Integer, nullable=False, default=0)
    reach            = Column(Integer, nullable=False, default=0)
    likes            = Column(Integer, nullable=False, default=0)
    shares           = Column(Integer, nullable=False, default=0)
    follows          = Column(Integer, nullable=False, default=0)
    comments         = Column(Integer, nullable=False, default=0)
    saves            = Column(Integer, nullable=False, default=0)
    imported_at      = Column(DateTime, nullable=False, default=datetime.utcnow)


class ActionBoardCache(Base):
    __tablename__ = "action_board_cache"

    id           = Column(Integer, primary_key=True, index=True)
    items        = Column(Text, nullable=False)   # JSON array — weekly_plan items
    generated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    source       = Column(String(10), nullable=False, server_default="mock")


class PostRanking(Base):
    __tablename__ = "post_rankings"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(String(64), nullable=False, index=True)
    rank_position = Column(Integer, nullable=False)
    score_label = Column(String(50), nullable=False)
    reasoning = Column(Text, nullable=False)
    generated_at = Column(DateTime, nullable=False)
    source = Column(String(10), nullable=False, server_default="mock")


class CalendarPost(Base):
    __tablename__ = "calendar_posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    date = Column(Date, nullable=False)
    time_slot = Column(String(20), nullable=True)
    content_type = Column(String(30), nullable=False)
    status = Column(String(20), nullable=False, default="Idea")
    hook = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    opening_script = Column(Text, nullable=True)
    products_to_mention = Column(Text, nullable=True)   # JSON array string
    hashtags = Column(Text, nullable=True)               # JSON array string
    recommended_duration = Column(String(20), nullable=True)  # e.g. "20-30s"
    created_at           = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at           = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    details_generated_at = Column(DateTime, nullable=True)  # last time generate-details was called


class HqGlanceCache(Base):
    """Cached HQ Glance result — one row, updated on each computation."""
    __tablename__ = "hq_glance_cache"

    id                  = Column(Integer, primary_key=True)
    top_post            = Column(Text, nullable=False)
    follower_growth     = Column(Text, nullable=False)
    top_signal          = Column(Text, nullable=False)
    priority_action     = Column(Text, nullable=False)
    generated_at        = Column(DateTime, nullable=False)
    # Manual refresh tracking — resets each calendar day
    daily_refresh_count = Column(Integer, nullable=False, default=0)
    daily_refresh_date  = Column(Date, nullable=True)


class Headline(Base):
    __tablename__ = "headlines"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    source = Column(String(100), nullable=False)
    summary = Column(Text, nullable=True)
    url = Column(Text, nullable=False)
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)
