import logging
import traceback
from datetime import datetime, timedelta

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from app.limiter import limiter
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Post, PostRanking
from app.services.mock_data import get_mock_ranked_posts
from app.services.post_ranking import generate_ranking
from app.utils import next_monday_iso, week_start_utc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/posts", tags=["posts"])

_SOURCE_REAL = "real"
_CACHE_TTL_HOURS = 48
_WEEKLY_CALL_LIMIT = 3
_MAX_POSTS_TO_RANK = 20
_MIN_POSTS_TO_RANK = 3


def _weekly_real_count(db: Session) -> int:
    """Count distinct generation batches (by unique generated_at) for this week."""
    return (
        db.query(func.count(func.distinct(PostRanking.generated_at)))
        .filter(PostRanking.source == _SOURCE_REAL, PostRanking.generated_at >= week_start_utc())
        .scalar()
        or 0
    )


def _post_to_dict(p: Post) -> dict:
    return {
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
        "ai_analysis": p.ai_analysis,
    }


def _posts_by_id_for_batch(db: Session, batch: list[PostRanking]) -> dict[str, dict]:
    post_ids = [row.post_id for row in batch]
    posts = db.query(Post).filter(Post.post_id.in_(post_ids)).all()
    return {p.post_id: _post_to_dict(p) for p in posts}


def _serialise(batch: list[PostRanking], posts_by_id: dict[str, dict], calls_used: int) -> dict:
    merged = [
        {
            "rank_position": row.rank_position,
            "post_id": row.post_id,
            "score_label": row.score_label,
            "reasoning": row.reasoning,
            **posts_by_id.get(row.post_id, {}),
        }
        for row in batch
    ]
    return {
        "ranked": True,
        "posts": merged,
        "generated_at": batch[0].generated_at.isoformat(),
        "source": batch[0].source,
        "calls_used": calls_used,
        "calls_max": _WEEKLY_CALL_LIMIT,
    }


def _latest_batch(db: Session) -> list[PostRanking]:
    latest_ts = (
        db.query(func.max(PostRanking.generated_at))
        .filter(PostRanking.source == _SOURCE_REAL)
        .scalar()
    )
    if latest_ts is None:
        return []
    return (
        db.query(PostRanking)
        .filter(PostRanking.generated_at == latest_ts, PostRanking.source == _SOURCE_REAL)
        .order_by(PostRanking.rank_position)
        .all()
    )


@router.get("/ranked")
async def ranked_posts(db: Session = Depends(get_db)):
    settings = get_settings()
    try:
        if settings.use_mock_data:
            return get_mock_ranked_posts()

        count = _weekly_real_count(db)
        cutoff = datetime.utcnow() - timedelta(hours=_CACHE_TTL_HOURS)

        # Single query: all real rankings within 48 h, ordered newest first
        recent_rows = (
            db.query(PostRanking)
            .filter(PostRanking.source == _SOURCE_REAL, PostRanking.generated_at >= cutoff)
            .order_by(PostRanking.generated_at.desc())
            .all()
        )
        if recent_rows:
            latest_ts = recent_rows[0].generated_at
            batch = [r for r in recent_rows if r.generated_at == latest_ts]
            batch.sort(key=lambda r: r.rank_position)
            posts_by_id = _posts_by_id_for_batch(db, batch)
            return JSONResponse(content=_serialise(batch, posts_by_id, count), headers={"X-Cache": "hit"})

        if count >= _WEEKLY_CALL_LIMIT:
            stale_batch = _latest_batch(db)
            if stale_batch:
                posts_by_id = _posts_by_id_for_batch(db, stale_batch)
                return JSONResponse(
                    content=_serialise(stale_batch, posts_by_id, count),
                    headers={"X-Cache": "stale"},
                )
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Weekly limit reached",
                    "calls_used": count,
                    "calls_max": _WEEKLY_CALL_LIMIT,
                    "resets_at": next_monday_iso(),
                },
            )

        db_posts = db.query(Post).order_by(Post.timestamp.desc()).limit(_MAX_POSTS_TO_RANK).all()
        posts_dicts = [_post_to_dict(p) for p in db_posts]

        if len(posts_dicts) < _MIN_POSTS_TO_RANK:
            return {
                "ranked": False,
                "posts": posts_dicts,
                "reason": f"Not enough posts to rank (minimum {_MIN_POSTS_TO_RANK} required)",
            }

        ranking = await generate_ranking(posts_dicts)
        now = datetime.utcnow()
        rows = [
            PostRanking(
                post_id=item["post_id"],
                rank_position=item["rank_position"],
                score_label=item["score_label"],
                reasoning=item["reasoning"],
                generated_at=now,
                source=_SOURCE_REAL,
            )
            for item in ranking
        ]
        db.add_all(rows)
        db.commit()

        posts_by_id = {p["post_id"]: p for p in posts_dicts}
        return _serialise(rows, posts_by_id, count + 1)

    except Exception as exc:
        logger.error("ranked_posts failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=502, detail="Failed to generate post ranking") from exc


# ── Cache AI analysis on post ────────────────────────────────────────────────

class SaveAnalysisRequest(BaseModel):
    analysis: str
    is_final: bool


@router.patch("/{post_id}/ai-analysis")
def save_post_analysis(post_id: str, payload: SaveAnalysisRequest, db: Session = Depends(get_db)):
    """Persist the generated AI analysis on the post.

    Rules:
    - If analysis_is_final=True in DB → never overwrite (return cached).
    - Otherwise → save/overwrite, updating analysis_is_final to payload.is_final.
      This allows upgrading an early analysis (is_final=False) to final (is_final=True).
    """
    post = db.query(Post).filter(Post.post_id == post_id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.analysis_is_final:
        # Already finalized — return existing without overwriting
        return {"post_id": post_id, "ai_analysis": post.ai_analysis, "cached": True}
    post.ai_analysis = payload.analysis
    post.analysis_is_final = payload.is_final
    db.commit()
    return {"post_id": post_id, "ai_analysis": post.ai_analysis, "cached": False}


# ── Post AI analysis ──────────────────────────────────────────────────────────

_MOCK_ANALYSIS = (
    "This is a Single Product Showcase — the format that consistently earns the lowest "
    "saves and shares on your account, and a score of 0 confirms it here. "
    "The Rare Beauty Foundation has Celebrity ID potential: Selena Gomez wore it to "
    "the Oscars — reframe this as a Celebrity ID post and pair it with the Shoppers "
    "Drug Mart shade match in the second half to turn a passive view into a save."
)

# Lightweight keyword classifier — gives Claude a concrete starting point
# so it can confirm or refine, rather than guessing from numbers alone.

_CELEBRITY_SIGNALS = [
    "oscars", "emmys", "grammys", "golden globes", "red carpet", "met gala",
    "wore", "wearing", "celebrity", "actor", "singer", "model",
    "selena", "hailey", "zendaya", "beyonce", "beyoncé",
    "taylor", "rihanna", "jennifer", "anne hathaway", "kardashian",
]

_DUPE_SIGNALS = [
    "dupe", "alternative", "similar", "under $", "drugstore version",
    "looks like", "affordable version", "cheaper", "budget",
]

_PERSONAL_SIGNALS = [
    "bought for myself", "treated myself", "my purchase", "i finally got",
    "market", "small business", "local brand", "found this at",
    "my story", "personal", "milestone", "anniversary", "birthday",
    "community", "event", "pop-up", "vendor", "artisan",
    "for me", "myself", "my own", "i got", "i found",
]

_FORMAT_HINTS = [
    ("Hack Universal", [
        "hack", "how to", "tested", "test", "winner", "method", "trick",
        "tutorial", "tips", "routine", "step by step", "diy", "works",
        "technique", "trying", "tried", "slugging", "pov:", "ranking",
    ]),
    ("Curation Local", [
        "shoppers", "sephora", "roundup", "top ", "best ", "under $",
        "drugstore", "canada", "canadian", "picks", "favourites", "favorites",
        "products", "drugstore finds",
    ]),
    ("Personal/Lifestyle", _PERSONAL_SIGNALS),
]


def _classify_format(caption: str) -> str:
    """Return the most likely content format based on caption keywords.

    Celebrity ID is handled first with two sub-variants:
    - Celebrity ID+Real Product: celebrity + exact product, no dupe signals
    - Celebrity ID+Dupe: celebrity + dupe/affordable alternative signals
    """
    lower = caption.lower()

    has_celebrity = any(sig in lower for sig in _CELEBRITY_SIGNALS)
    if has_celebrity:
        has_dupe = any(sig in lower for sig in _DUPE_SIGNALS)
        return "Celebrity ID+Dupe" if has_dupe else "Celebrity ID+Real Product"

    scores: dict[str, int] = {}
    for fmt_name, keywords in _FORMAT_HINTS:
        scores[fmt_name] = sum(1 for kw in keywords if kw in lower)
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "Single Product Showcase"


def _post_age_hours(timestamp_str: str) -> float | None:
    """Return post age in fractional hours from an ISO 8601 string, or None if unparseable."""
    from datetime import timezone
    try:
        ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - ts).total_seconds() / 3600
    except Exception:
        return None


class AnalyzeRequest(BaseModel):
    metrics: dict
    averages: dict


def _build_analyze_prompt(metrics: dict, averages: dict) -> str:
    import math

    caption = str(metrics.get("caption") or "")
    reach   = int(metrics.get("reach") or 0)
    saves   = int(metrics.get("saves") or 0)
    shares  = int(metrics.get("shares") or 0)
    likes   = int(metrics.get("likes") or 0)
    comments = int(metrics.get("comments") or 0)
    er      = float(metrics.get("engagement_rate") or 0)
    views   = int(metrics.get("views") or 0)
    fmt     = str(metrics.get("media_type") or "unknown")

    # Performance score using her formula
    score     = round((shares * 4 + saves * 3) * math.log(reach + 1)) if reach > 0 else 0
    avg_score = 123   # (3×4 + 2×3) × log(947+1), her account baseline
    combined  = saves + shares   # her key signal: saves+shares baseline is 5

    # Python pre-classifies the format so Claude can confirm/refine rather than guess
    detected_format = _classify_format(caption)

    # "Repeat this" block: Reel with strong view distribution but low conversion
    is_reel = fmt.upper() == "REEL"
    repeat_trigger = (
        is_reel
        and views >= 2000
        and combined < (averages.get("avg_saves", 2) + averages.get("avg_shares", 3)) * 0.8
    )

    caption_display = caption[:300] + "…" if len(caption) > 300 else caption

    # Reach-to-follower ratio signals distribution beyond existing audience
    # Account has ~947 avg reach vs approximate follower count context
    reach_signal = "reached beyond her existing audience" if reach > 1500 else "stayed mostly within her existing audience"

    prompt = f"""You are a growth strategist for @creator_demo, a beauty creator in Toronto. Your north star is audience growth — more reach, more followers, more shares that expose her to people who don't follow her yet. Saves matter because they signal the algorithm to push content further. Shares matter because they directly put her content in front of new people. Never frame anything around purchase conversion.

POST DATA:
- Caption: {caption_display}
- Shares: {shares}, Saves: {saves}, Reach: {reach:,}, Likes: {likes}, Comments: {comments}, ER: {er:.1f}%
- Distribution signal: {reach_signal} (account avg reach: 947)
- Shares+saves score: {combined} (account baseline: 5)
{f"- Video views: {views:,}" if views else ""}

FORMAT HINT: Based on the caption, this looks like a "{detected_format}" post. Confirm or correct this in your response.

HER 5 FORMATS and their shareability profile:
- Celebrity ID+Real Product: people share these to tag a friend who needs the product — high share potential when the celebrity moment is culturally relevant.
- Celebrity ID+Dupe: highest share potential on her account — people send these to friends specifically to save them money. Anne Hathaway Oscars concealer: 23 shares, 20 saves, 2.6K reach.
- Hack Universal: shared when the result is genuinely surprising — the outcome needs to be visible and unexpected, not the process.
- Curation Local: saved when it solves a specific upcoming moment (a season, event, or need) — saves signal the algorithm; reach comes after.
- Single Product Showcase: lowest shareability — no social trigger to send to someone else.
- Personal/Lifestyle: builds follow intent in new viewers — people follow accounts whose personality they connect with, not just the content.

WRITE exactly 2 short paragraphs:

Paragraph 1 (2 sentences max): Name the format. Answer this specific question: would a non-follower who stumbled onto this post share it with someone, and why or why not? Use the actual shares ({shares}) and reach ({reach:,}) to ground your answer.

Paragraph 2 (2 sentences max): One recommendation that increases shareability or discoverability — tied to her format:
- If Celebrity ID+Real Product: what angle or question would make someone tag a friend in the comments or send it to their group chat?
- If Celebrity ID+Dupe: what would make someone send this to a friend specifically to save them money — what detail is missing that would trigger that share?
- If Hack Universal: what about the outcome or the reveal would make a non-follower hit share — is the surprising result shown early enough?
- If Curation Local: what specific moment, season, or event could anchor this list so it gets saved by people who don't follow her yet?
- If Single Product Showcase: what single change — a celebrity angle, a before/after, a comparison — would give a non-follower a reason to send this to someone?
- If Personal/Lifestyle: what element of this moment would make a new viewer want to follow to see what she posts next — end with something that creates anticipation.

RULES (non-negotiable):
- Never mention adding links, price points, or purchase friction removal
- Never say "hook in 3 seconds", "add a CTA", "engage with comments"
- Every recommendation must answer: would a non-follower share this — and what specific change makes that more likely?
- No markdown, no headers, no bullet points
- Maximum 4 sentences total
- Coaching tone, never critical"""

    if repeat_trigger:
        prompt += (
            f"\n\nADDITIONAL BLOCK: After the 2 paragraphs, add one sentence starting with "
            f"'Repeat this:' — {views:,} views reached new people but only {combined} saves+shares "
            f"converted that distribution into signal. Name the specific format variation and one "
            f"scene or angle in the second half of the video that would have given viewers a reason "
            f"to share it with someone who doesn't follow her yet."
        )

    return prompt


@router.post("/analyze")
@limiter.limit("20/hour")
async def analyze_post(request: Request, payload: AnalyzeRequest):
    settings = get_settings()

    if settings.use_mock_data:
        return {"analysis": _MOCK_ANALYSIS, "source": "mock"}

    # Age guard — no Claude call for posts under 24 h old
    age_hours = _post_age_hours(str(payload.metrics.get("timestamp", "")))
    if age_hours is not None and age_hours < 24:
        hours = max(1, int(age_hours))
        unit = "hour" if hours == 1 else "hours"
        return {
            "analysis": (
                f"This post is only {hours} {unit} old — come back tomorrow for a real "
                "read on how it's performing. Instagram distributes content over 24-48 hours "
                "so early numbers don't tell the full story."
            ),
            "source": "age_check",
        }

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        prompt = _build_analyze_prompt(payload.metrics, payload.averages)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=450,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text.strip()

        # Prepend early-data disclaimer for 24-72 h posts
        if age_hours is not None and 24 <= age_hours < 72:
            text = "Early data (48h) — trending direction visible but final numbers pending.\n\n" + text

        return {"analysis": text, "source": "real"}
    except Exception as exc:
        logger.error("analyze_post failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to generate post analysis") from exc
