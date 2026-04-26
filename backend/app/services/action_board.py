"""
Action Board service — generates a 7-post weekly content plan using Claude Sonnet.
Analyses last 60 posts (live + historical CSV) and returns strict JSON.

Prompt architecture:
  - _STATIC_PROMPT  : account rules, format definitions, JSON schema — never changes.
                      Marked as cacheable (cache_control: ephemeral).
                      With 3 calls/week, calls 2 and 3 always get a cache hit (~70% token savings).
  - _build_dynamic_prompt(): seasonal context, post performance data, weekly history.
                      Injected fresh on every call.
"""
import asyncio
import statistics
from collections import defaultdict
from datetime import datetime

import pytz
import anthropic

from app.config import get_settings
from app.utils import parse_claude_json, post_weighted_score

TORONTO_TZ = pytz.timezone("America/Toronto")

_settings = get_settings()
_client = anthropic.Anthropic(api_key=_settings.anthropic_api_key)


# ── Static prompt block (cached) ─────────────────────────────────────────────
# Everything here is account-level knowledge that never changes between calls.
# Minimum 1024 tokens required for caching — this block is ~900 words / ~1300 tokens.

_STATIC_PROMPT = """You are a content strategist for a Canadian beauty and skincare creator with an English-speaking North American audience.

THE 4 CONTENT FORMATS THAT DEFINE THIS ACCOUNT (use these as the backbone of every recommendation):

Format A — CELEBRITY ID + REAL PRODUCT (LOCAL)
Identify the exact foundation, blush, concealer, or skincare product a celebrity wore at a major event (Oscars, Met Gala, premieres, red carpets). Name the product specifically. Link to Sephora Canada as the purchase anchor. Best performing example: Anne Hathaway Oscars concealer — 20 saves, 23 shares, 2.6K reach.

Format B — CELEBRITY ID + DUPE (LOCAL)
Same celebrity detective angle, but find the drugstore dupe available at Shoppers Drug Mart. The contrast between luxury and affordable is the hook. Audience saves these to send to friends.

Format C — HACK UNIVERSAL
A beauty or skincare technique that works for anyone regardless of budget, skin type, or location. No retailer anchor needed. These drive shares because people send them to their circle.

Format D — CURATION LOCAL
A product roundup built around Canadian retailers: premium picks from Sephora Canada, drugstore picks from Shoppers Drug Mart. Example: "5 concealers at Shoppers under $20 that actually cover dark circles". Drives saves as a shopping reference.

RETAILER ANCHORS (non-negotiable for local formats):
- Premium: Sephora Canada
- Drugstore: Shoppers Drug Mart
- Never recommend US-only retailers (Ulta, Target, CVS) as the primary anchor.

POSTING WINDOW: Primary window is 18:00-19:00 EST. For Trial Reels (non-follower test posts), recommend 13:00 EST. Vary exact minutes (e.g. 18:00, 18:15, 18:30, 18:45). Do not use the same time for every day.

TRIAL REELS STRATEGY: Mark 2-3 of the 7 posts as Trial Reels (field: "is_trial_reel": true). Trial Reels show only to non-followers first — ideal for testing new hooks or content that might not resonate with the legacy Latin American audience. If the trial performs well, it gets shared to all followers. This is the account's primary tool to reset audience categorization from Spanish to English. Trial Reels should be scheduled at 13:00 EST.

COLD STREAK AWARENESS: If a reel gets fewer than 1,000 views in 6 hours, do not promote it via Stories. Low watch time on one reel lowers the initial test pool for the next reel. Quality over volume — it is better to skip a day than to post content below the minimum quality threshold.

ANTI-PATTERNS (never recommend):
- Single product showcase with no comparison or celebrity hook (0 saves/shares consistently)
- Overly promotional captions with no educational value
- Generic tips with no specific product, brand, or celebrity reference
- Content without a Canadian retail anchor when doing local formats

YOUR TASK:
Generate exactly 7 post recommendations, one per day Monday through Sunday.

WEEKLY COMPOSITION (non-negotiable):
- 3 LOCAL posts: one Format A, one Format B, one Format D
- 2 UNIVERSAL posts: both Format C (different angles)
- 2 FLEX posts: any format that best matches top performance patterns from the data above

For each post generate 3 hooks (short, punchy, scroll-stopping opening lines).

The format field must be a short descriptor like "Reel (30s): routine walkthrough" or "Carousel: product ranking". For Reels, always include the recommended duration: 7-15s for fast reveals and hooks, 20-30s for celebrity detective and tutorials, 45-60s for deep dives. Carousels do not need duration. Do not use em dashes. Use commas or colons instead.

Return ONLY the following strict JSON. No explanation outside the JSON:

{
  "weekly_plan": [
    {
      "post_number": 1,
      "day": "Monday",
      "time": "18:00",
      "format_type": "A",
      "format": "Reel (20s): celebrity product ID",
      "hooks": [
        "First hook option",
        "Second hook option",
        "Third hook option"
      ],
      "content_angle": "One sentence describing exactly what celebrity, product, and event this covers.",
      "retailer_anchor": "Sephora Canada",
      "why_it_should_work": "One or two sentences explaining why this drives saves and shares based on the account data.",
      "target_metrics": {
        "saves": 12,
        "shares": 8,
        "reach_multiplier": 1.6
      },
      "confidence_score": 88,
      "is_trial_reel": false
    }
  ]
}

Rules:
- format_type: "A", "B", "C", "D", or "FLEX"
- retailer_anchor: "Sephora Canada", "Shoppers Drug Mart", "Both", or "None" (only None for Format C)
- reach_multiplier: float 1.0 to 3.0. Celebrity ID posts and Hacks can target higher.
- confidence_score: integer 0-100, based on how closely this matches proven account patterns
- is_trial_reel: true for 2-3 posts per week that test content with non-followers first (schedule these at 13:00 EST)

Do NOT discuss engagement rate. Success signals are shares (DM sends), saves, and reach, in that order.
Do NOT use em dashes anywhere in the output.
For each post's why_it_should_work field: explain specifically why this content drives DM sends (people sharing to friends) AND saves. DM send potential is the #1 growth signal in 2026."""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_season_context() -> str:
    now = datetime.now(TORONTO_TZ)
    month = now.month
    if month in (12, 1, 2):
        season = "winter"
        context = "cold weather skincare, hydration, barrier repair, holiday makeup"
    elif month in (3, 4, 5):
        season = "spring"
        context = "post-winter skin recovery, UV protection as sun increases, spring makeup trends, lighter routines"
    elif month in (6, 7, 8):
        season = "summer"
        context = "SPF, sweat-proof makeup, oil control, minimal routines, beach-ready skin"
    else:
        season = "fall"
        context = "back to routine, richer moisturizers, transitional skincare, fall makeup trends"

    today = now.strftime("%B %d, %Y")
    return f"Current date: {today}. Season: {season} in Canada and the US. Relevant seasonal topics: {context}."


def _aggregate_patterns(posts: list[dict]) -> dict:
    if len(posts) < 4:
        return {
            "best_day": "Saturday",
            "best_time": "17:00",
            "best_format": "REEL",
            "avg_saves": 0,
            "avg_shares": 0,
            "avg_reach": 0,
            "total_posts": len(posts),
        }

    day_scores: dict[str, list[int]] = defaultdict(list)
    hour_scores: dict[int, list[int]] = defaultdict(list)
    format_scores: dict[str, list[int]] = defaultdict(list)
    saves_list: list[int] = []
    shares_list: list[int] = []
    reach_list: list[int] = []

    for p in posts:
        saved = p.get("saved", 0)
        shares = p.get("shares", 0)
        sv = post_weighted_score(p)
        saves_list.append(saved)
        shares_list.append(shares)
        reach_list.append(p.get("reach", 0))

        ts = p.get("timestamp") or p.get("publish_time")
        if ts:
            try:
                dt = datetime.fromisoformat(str(ts)) if not isinstance(ts, datetime) else ts
                if dt.tzinfo is None:
                    dt = pytz.utc.localize(dt)
                dt = dt.astimezone(TORONTO_TZ)
                day_scores[dt.strftime("%A")].append(sv)
                hour_scores[dt.hour].append(sv)
            except ValueError:
                pass
        fmt = (p.get("media_type") or p.get("post_type") or "").strip()
        if fmt:
            format_scores[fmt].append(sv)

    day_means = {d: statistics.mean(v) for d, v in day_scores.items()}
    hour_means = {h: statistics.mean(v) for h, v in hour_scores.items()}
    format_means = {f: statistics.mean(v) for f, v in format_scores.items()}

    best_day = max(day_means, key=day_means.get, default="Saturday")
    best_hour = max(hour_means, key=hour_means.get, default=17)
    best_format = max(format_means, key=format_means.get, default="REEL")

    return {
        "best_day": best_day,
        "best_time": f"{best_hour:02d}:00",
        "best_format": best_format,
        "avg_saves": round(statistics.mean(saves_list)),
        "avg_shares": round(statistics.mean(shares_list)),
        "avg_reach": round(statistics.mean(reach_list)),
        "total_posts": len(posts),
    }


def _fmt_post(p: dict) -> str:
    fmt = p.get("media_type") or p.get("post_type") or "UNKNOWN"
    ts = p.get("timestamp") or p.get("publish_time") or ""
    day_str = ""
    if ts:
        try:
            dt = datetime.fromisoformat(str(ts)) if not isinstance(ts, datetime) else ts
            if dt.tzinfo is None:
                dt = pytz.utc.localize(dt)
            dt = dt.astimezone(TORONTO_TZ)
            day_str = f" posted {dt.strftime('%A at %H:%M')} EST"
        except ValueError:
            pass
    caption = str(p.get("caption", ""))[:300]
    return (
        f'[{fmt}]{day_str} — Saves: {p.get("saved", 0):,} | Shares: {p.get("shares", 0):,} | '
        f'Reach: {p.get("reach", 0):,}\n'
        f'   Caption: "{caption}"'
    )


def _build_history_block(history: list[dict]) -> str:
    """Format previous weekly plans so Claude avoids repeating the same angles.

    Each entry in history is an ActionBoardCache-derived dict:
      { "generated_at": "2026-04-18T...", "weekly_plan": [...] }
    """
    if not history:
        return ""

    labels = ["Two weeks ago", "Last week"]
    blocks: list[str] = []

    for label, entry in zip(labels[2 - len(history):], history):
        plan = entry.get("weekly_plan") or []
        if not plan:
            continue
        generated_at = entry.get("generated_at", "")
        date_str = ""
        if generated_at:
            try:
                date_str = f" (generated {datetime.fromisoformat(generated_at).strftime('%b %d')})"
            except ValueError:
                pass

        lines = [f"{label}{date_str}:"]
        for post in plan:
            day = post.get("day", "?")
            fmt_type = post.get("format_type", "?")
            angle = post.get("content_angle", "")[:120]
            lines.append(f"  {day} — Format {fmt_type}: {angle}")
        blocks.append("\n".join(lines))

    if not blocks:
        return ""

    return (
        "CONTENT CALENDAR — PREVIOUS WEEKS "
        "(avoid repeating the same celebrity, event, or product combination):\n\n"
        + "\n\n".join(blocks)
        + "\n\nUse this history to vary celebrity references, product categories, and format angles. "
        "Do not suggest an identical celebrity + event + product combination as any entry above.\n"
    )


def _build_dynamic_prompt(posts: list[dict], patterns: dict, history: list[dict]) -> str:
    ranked = sorted(posts, key=post_weighted_score, reverse=True)
    top5 = ranked[:5]
    bottom5 = ranked[-5:] if len(ranked) > 5 else []

    top_block = "\n\n".join(_fmt_post(p) for p in top5)
    bottom_section = (
        f"BOTTOM 5 POSTS by saves and shares (patterns to avoid):\n"
        + "\n".join(_fmt_post(p) for p in bottom5) + "\n\n"
        if bottom5 else ""
    )

    history_block = _build_history_block(history)

    return f"""SEASONAL CONTEXT: {_get_season_context()}
Maximum 1 out of 7 posts should reference seasonal topics directly.

ACCOUNT PERFORMANCE PATTERNS (from {patterns["total_posts"]} posts):
- Best posting day: {patterns["best_day"]}
- Best performing format: {patterns["best_format"]}
- Average saves per post: {patterns["avg_saves"]:,}
- Average shares per post: {patterns["avg_shares"]:,}
- Average reach per post: {patterns["avg_reach"]:,}

TOP 5 POSTS by saves and shares (proven patterns to replicate):
{top_block}

{bottom_section}{history_block}Target saves above {patterns["avg_saves"]:,} and shares above {patterns["avg_shares"]:,} for each post."""


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_action_board(posts: list[dict], history: list[dict] | None = None) -> dict:
    """Generate a 7-post weekly plan.

    Args:
        posts:   Up to 60 recent posts (live API + historical CSV).
        history: Up to 2 previous ActionBoardCache entries (oldest first).
                 Used to avoid repeating the same content angles week over week.
    """
    patterns = _aggregate_patterns(posts)
    dynamic  = _build_dynamic_prompt(posts, patterns, history or [])

    message = _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4500,
        messages=[
            {
                "role": "user",
                "content": [
                    # Static block — cached after the first call.
                    # Calls 2 and 3 of the week always get a cache hit (~70% token savings).
                    {
                        "type": "text",
                        "text": _STATIC_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    },
                    # Dynamic block — fresh every call (posts, patterns, history).
                    {
                        "type": "text",
                        "text": dynamic,
                    },
                ],
            }
        ],
    )

    return parse_claude_json(message.content[0].text)


def _build_post_details_prompt(post_idea: str, hook: str, content_angle: str) -> str:
    season = _get_season_context()
    return f"""You are a content strategist for a Canadian beauty and skincare creator.
Target audience: US and Canadian English-speaking beauty consumers.
Retailer anchors: Sephora Canada (premium), Shoppers Drug Mart (drugstore). Never recommend US-only retailers as the primary anchor.
{season}

Post idea: {post_idea}
Hook: {hook}
Content angle: {content_angle}

Return VALID JSON ONLY. No markdown, no explanation, no text outside the JSON.
The response must begin with {{ and end with }}.

Generate the following fields:

"opening_script": The exact words for the first 3-5 seconds of the video. Maximum 2 sentences. Conversational tone. Must start with a line that creates immediate curiosity, challenge, or surprise. Written as the creator would say it on camera.

"products_to_mention": A JSON array of 1 to 3 specific product names available in Canada. Be specific (brand and product name). If the content is local format, prefer products sold at Sephora Canada or Shoppers Drug Mart. Example: ["Charlotte Tilbury Airbrush Flawless Foundation", "L'Oreal True Match Concealer"].

"hashtags": A JSON array of 3 to 5 hashtags optimized for US and Canadian beauty discovery on Instagram. No generic ones like #beauty, #makeup, #skincare, or #fyp. Focus on niche, community, and product-specific tags. Example: ["#drugstorebeauty", "#canadianbeauty", "#foundationreview"].

"recommended_duration": A single string indicating the ideal video length. Use exactly one of: "15-20s", "20-30s", "30-45s", "45-60s". Tutorials and comparisons need more time. Reveals and hooks need less.

Return only the JSON object."""


async def generate_post_details(post_idea: str, hook: str, content_angle: str) -> dict:
    message = await asyncio.to_thread(
        _client.messages.create,
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": _build_post_details_prompt(post_idea, hook, content_angle)}],
    )
    return parse_claude_json(message.content[0].text)