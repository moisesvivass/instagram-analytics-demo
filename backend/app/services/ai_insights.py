"""
Claude Sonnet service for generating AI insights.
When USE_MOCK_DATA=true, returns static mock insights.
When USE_MOCK_DATA=false, calls Claude Sonnet (claude-sonnet-4-6).
"""
import statistics
from collections import defaultdict
from datetime import datetime

import pytz
import anthropic

from app.config import get_settings
from app.services.mock_data import get_mock_hq_glance
from app.utils import parse_claude_json, post_weighted_score

TORONTO_TZ = pytz.timezone("America/Toronto")


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


_settings = get_settings()
_client   = anthropic.Anthropic(api_key=_settings.anthropic_api_key)


def _compute_benchmarks(posts: list[dict]) -> dict:
    if len(posts) < 4:
        return {}

    sv_list    = sorted(post_weighted_score(p) for p in posts)
    reach_list = sorted(p["reach"] for p in posts)
    n = len(sv_list)

    hour_scores: dict[int, list[int]]  = defaultdict(list)
    day_scores:  dict[str, list[int]]  = defaultdict(list)
    type_scores: dict[str, list[int]]  = defaultdict(list)

    for p in posts:
        ts = p.get("timestamp") or p.get("publish_time")
        if ts:
            try:
                dt = datetime.fromisoformat(str(ts)) if not isinstance(ts, datetime) else ts
                if dt.tzinfo is None:
                    dt = pytz.utc.localize(dt)
                dt = dt.astimezone(TORONTO_TZ)
                hour_scores[dt.hour].append(post_weighted_score(p))
                day_scores[dt.strftime("%A")].append(post_weighted_score(p))
            except ValueError:
                pass
        content_type = (p.get("media_type") or p.get("post_type") or "").strip()
        if content_type:
            type_scores[content_type].append(post_weighted_score(p))

    hour_means = {h: statistics.mean(v) for h, v in hour_scores.items()}
    day_means  = {d: statistics.mean(v) for d, v in day_scores.items()}
    type_means = {t: statistics.mean(v) for t, v in type_scores.items()}
    best_hour  = max(hour_means, key=hour_means.get, default=None)
    best_day   = max(day_means,  key=day_means.get,  default=None)
    top_type   = max(type_means, key=type_means.get, default=None)

    top3_hours = sorted(hour_means, key=hour_means.get, reverse=True)[:3]
    top3_days  = sorted(day_means,  key=day_means.get,  reverse=True)[:3]
    worst_days = sorted(day_means,  key=day_means.get)[:2]

    return {
        "avg_weighted_score":       round(statistics.mean(sv_list)),
        "winner_threshold":         sv_list[int(n * 0.75)],
        "underperformer_threshold": sv_list[int(n * 0.25)],
        "avg_reach":                round(statistics.mean(reach_list)),
        "high_reach_threshold":     reach_list[int(n * 0.75)],
        "best_hour":                best_hour,
        "best_day":                 best_day,
        "top3_hours":               [(h, round(hour_means[h], 1)) for h in top3_hours],
        "top3_days":                [(d, round(day_means[d], 1)) for d in top3_days],
        "worst_days":               [(d, round(day_means[d], 1)) for d in worst_days],
        "top_content_type":         top_type,
        "total_posts_analyzed":     n,
    }


def _build_prompt(posts: list[dict], benchmarks: dict | None = None) -> str:
    if not posts:
        return ""

    use_benchmarks = bool(benchmarks)

    by_value = sorted(posts, key=post_weighted_score, reverse=True)

    if use_benchmarks:
        winner_sv       = benchmarks["winner_threshold"]
        underperform_sv = benchmarks["underperformer_threshold"]
        high_reach      = benchmarks["high_reach_threshold"]

        def _classify(p: dict) -> str:
            sv = post_weighted_score(p)
            is_high_reach = p["reach"] >= high_reach
            is_high_value = sv >= winner_sv
            is_low_value  = sv <= underperform_sv
            if is_high_reach and is_high_value:
                return " ⚑ WINNER"
            elif not is_high_reach and is_high_value:
                return " ⚑ PROMISING"
            elif is_high_reach and is_low_value:
                return " ⚑ UNDERPERFORMER"
            return ""
    else:
        by_reach_sorted = sorted(posts, key=lambda p: p["reach"], reverse=True)
        mid = len(posts) // 2
        median_value = post_weighted_score(by_value[mid])
        median_reach = by_reach_sorted[mid]["reach"]

        def _classify(p: dict) -> str:
            high_reach = p["reach"] > median_reach
            high_value = post_weighted_score(p) > median_value
            if high_reach and high_value:
                return " ⚑ WINNER"
            elif not high_reach and high_value:
                return " ⚑ PROMISING"
            elif high_reach and not high_value:
                return " ⚑ UNDERPERFORMER"
            return ""

    def _fmt(p: dict, idx: int) -> str:
        flag = _classify(p)
        caption = p.get("caption") or ""
        words = [w for w in caption.split() if not w.startswith(("@", "#")) and len([c for c in w if c.isalpha()]) > 1]
        label = " ".join(words[:7]) if words else f"Post {idx}"
        return (
            f'Post: "{label}" [{p["media_type"]}]{flag}\n'
            f'   Caption: "{p["caption"][:300]}"\n'
            f'   Saves: {p["saved"]:,} | Shares: {p["shares"]:,} | Reach: {p["reach"]:,} | '
            f'Likes: {p["like_count"]:,} | Comments: {p["comments_count"]:,}'
        )

    all_posts_block = "\n\n".join(_fmt(p, i + 1) for i, p in enumerate(by_value))

    if use_benchmarks:
        n = benchmarks["total_posts_analyzed"]
        benchmarks_block = f"""ACCOUNT BENCHMARKS (calculated from {n} posts — live API + historical imports):
- Average weighted score per post: {benchmarks["avg_weighted_score"]:,} (shares×2 + saves)
- Winner threshold (top 25%): {benchmarks["winner_threshold"]:,} weighted score
- Underperformer threshold (bottom 25%): {benchmarks["underperformer_threshold"]:,} weighted score
- Average reach per post: {benchmarks["avg_reach"]:,}
- High reach threshold (top 25%): {benchmarks["high_reach_threshold"]:,}
- Best days ranked: {', '.join(f'{d} (avg {avg})' for d, avg in benchmarks.get('top3_days', []))}
- WORST days — NEVER recommend these for important posts: {', '.join(f'{d} (avg {avg})' for d, avg in benchmarks.get('worst_days', []))}
- Top content type by saves+shares: {benchmarks["top_content_type"] or "unknown"}

POSTING TIME NOTE: All historical posts were published around the same hour, so posting hour data from this account is not statistically meaningful. Use your knowledge of when US and Canadian beauty audiences are most active on Instagram to recommend the optimal posting time for each day. Vary times based on the day of the week and what typically performs best for English-speaking North American audiences in the beauty and skincare niche.

Use THESE thresholds for all classification and analysis — they are Creator's actual account standards, not generic Instagram benchmarks.

"""
    else:
        benchmarks_block = ""

    return f"""Return VALID JSON ONLY.
The response MUST:
- begin with {{
- end with }}
- be fully parseable by json.loads()
- contain no markdown, no explanations, no text outside the JSON
- contain exactly these four keys: what_working, what_flopping, briefing, action_board
If any section has insufficient signal, return an empty array or empty string instead of explanatory text.

You are a sharp, honest, encouraging creative director who specialises in beauty and skincare creators. You are advising @creator_demo — a Canadian beauty and skincare creator with ~26.4k followers.

ACCOUNT CONTEXT (critical for all recommendations):
The account recently transitioned from Spanish to English content. The current audience is legacy Latin American followers (Venezuela 16.5%, Mexico 14.2%, US 19.6%, Canada 2.1%) from the Spanish-language era. The growth target is US and Canadian English-speaking audiences. All recommendations for hooks, topics, brand partnerships, and timing must be optimized to attract NEW US and Canadian followers, not to retain the existing Latin American audience. Content is now fully in English.

SEASONAL CONTEXT: {_get_season_context()}
Use seasonal awareness as one factor among many, not the dominant theme.
A maximum of 1 or 2 out of 7 posts should reference seasonal topics directly.
The remaining posts should draw from the full range of beauty and skincare
content that drives saves and shares, using your knowledge of what works
for English-speaking North American audiences combined with the patterns
from Creator's actual data.

You have been given her recent posts ranked by saves + shares (highest first). Posts are classified as:
- ⚑ WINNER: high reach AND high saves+shares — content that reached new people and they found it worth saving or sharing
- ⚑ PROMISING: low reach but high saves+shares — good content that needs more distribution
- ⚑ UNDERPERFORMER: high reach but low saves+shares — content that does not connect despite visibility
- No flag: low reach AND low saves+shares — not enough signal yet

EVALUATION FRAMEWORK (Instagram 2026 algorithm — confirmed by Adam Mosseri):
PRIMARY signal (#1 for reaching non-followers): Shares/DM sends per reach — Instagram weights sends 3-5x more than likes when deciding whether to push content to new audiences. A post that gets DM'd gets distributed. This is the MOST IMPORTANT signal.
PRIMARY signal (#2 for follower retention): Saves — content worth returning to, drives repeat profile visits and algorithm trust with existing followers.
SECONDARY signals (supporting context): Reach (distribution), likes and comments (social validation but not growth drivers).
DO NOT use engagement rate — ER is misleading because it is inversely correlated with reach and penalises posts that achieve wide distribution.

CRITICAL ANALYSIS RULE: Every insight must reference measurable signals from the provided data. Never provide generic creator advice. Never use vague phrases like "your content performs well". Every conclusion must reference saves, shares, reach, format, or a recurring topic pattern.
Bad example: "Tutorials work well"
Good example: "Tutorial reels generated 2.3x average shares and were DM'd frequently"

STRATEGIC PRIORITY ORDER:
1. Shares (DM sends — primary growth driver for non-follower reach)
2. Saves (retention and repeat visits)
3. Reach
4. Follower growth potential
5. Likes/comments
Use this order for all recommendations and analysis. If the dataset signal is weak, express uncertainty explicitly inside the insight text instead of making overconfident conclusions. Example: "Likely audience fatigue in single-product reels"

CTA GUIDANCE: When recommending CTAs in next_step fields, prioritize "Send this to [specific person/scenario]" over "Save this". DM send CTAs drive non-follower reach. Save CTAs drive retention. Both matter but send CTAs are higher priority for growth.

{benchmarks_block}POSTS (ranked by saves + shares, high to low):

{all_posts_block}

---

Your job: produce a JSON object with EXACTLY these four keys. Never use the phrase "your content" generically — always name the specific post caption or format you are referencing.
Never reference posts as "Post 1", "Post 2" etc. Always use the caption snippet shown in the post data above to identify each post.

"what_working"
A JSON array of 3 to 5 objects. Each object identifies a content pattern (not a single post) that is driving saves and shares. Base the patterns on the top performers in the data above.
Format:
[
  {{"title": "Celebrity dupe reels", "insight": "Dupe reels averaged 3x saves vs account average, audience shares to inform friends", "next_step": "Film a reel identifying the exact product behind a celebrity look trending this week"}},
  {{"title": "Step-by-step tutorials", "insight": "High saves/reach ratio: educational content gets returned to repeatedly", "next_step": "Post a 5-step carousel breaking down the layering order for the top-saving routine"}}
]
Rules: title MUST be 2 to 4 words maximum in English, concise, naming the pattern not the post. insight maximum 15 words in English, one actionable sentence explaining the data signal behind the pattern. Do NOT use em dashes inside insight text — use commas or colons instead. next_step maximum 20 words in English, must start with a verb (Film, Post, Replace, Try, Use, Create, Share), must reference the specific data pattern identified in this insight not give generic advice.

"what_flopping"
A JSON array of 3 to 5 objects. Each object identifies a content pattern (not a single post) that is underperforming relative to its reach or expectations.
Same format as what_working including the next_step field.
Rules: title MUST be 2 to 4 words maximum in English. insight maximum 15 words in English, one actionable sentence naming the problem and a concrete fix. Do NOT use em dashes inside insight text. next_step maximum 20 words in English, must start with a verb, must reference the specific underperforming pattern and suggest a direct fix based on the data.

"briefing"
A weekly strategy briefing in markdown. Do NOT use em dashes (—) anywhere in this section. Include EXACTLY these six sections, each starting with the bold heading shown:

**What the Numbers Mean**
One paragraph using her actual numbers as examples. Explain the 2026 Instagram algorithm priority: shares/DM sends are the #1 signal for reaching non-followers (Instagram weights sends 3-5x more than likes), saves are the #1 signal for follower retention (content worth returning to). Reach shows distribution. Likes and comments confirm people saw it but do not drive redistribution the same way. End with one sentence on what CTA drives the most growth: "Send this to your friend who [specific scenario]" outperforms "Save this" for reaching new audiences. Tone: encouraging and educational.

**Content Pattern**
One paragraph naming the specific topic or format that is consistently driving her best saves and shares this cycle. Reference actual posts and numbers.

**Format Comparison: Reels vs Carousels**
Compare Reel performance against Carousel performance using the post data provided. Calculate or estimate average saves and average shares separately for each format. State which format drives more saves for this account, which drives more shares, and what that means for her content mix going forward. Be specific with numbers from the data.

**Next Post Idea**
One specific, ready-to-execute content idea based on what is driving saves and shares. Include suggested hook, format (Reel or Carousel), and topic angle. Make it actionable enough to brief a videographer or shoot solo.

**Brand Partnership Angle**
Based on her top performing content (by saves and shares), name the specific type of US or Canadian brand she should be pitching this week and explain why her data supports that pitch. Be specific (e.g. "a Canadian SPF brand like Attitude or Green Beaver" not just "a skincare brand"). Focus only on North American brands aligned with her English-speaking growth target.

**Road to 100k**
Honest one-paragraph assessment of her current follower pace using the data. Consider that she is rebuilding her audience from a Spanish-speaking base to an English-speaking one, so early growth numbers may be slow. End with one specific action that could meaningfully accelerate growth in the US and Canadian markets based on what is already working in her saves and shares numbers.

"action_board"
A JSON array of exactly 7 items, one for each day of the week Monday through Sunday. Generate actions based ONLY on the highest-performing patterns detected in the current dataset, prioritizing formats and topics with above-average saves/share ratios. Each string is one specific, concrete content creation action for the coming week. Every action must include: the topic, the format (Reel or Carousel), and your recommended optimal posting time in EST based on your knowledge of when US and Canadian beauty audiences are most active — vary the time by day, do not use the same time for every day. Do NOT include generic actions like "respond to comments", "post consistently", or "engage with your audience". Only content creation decisions. Format each action as a single sentence starting with "Post a [format] on [day] at [your recommended time] EST: [specific topic and angle]."

Return only the JSON object. No explanation outside the JSON. Do not mention revenue numbers or specific payment amounts."""


def _build_hq_prompt(posts: list[dict], growth: list[dict]) -> str:
    top_post = max(posts, key=lambda p: p["saved"] + p["shares"], default={})
    top_saves = top_post.get("saved", 0)
    top_shares = top_post.get("shares", 0)
    top_reach = top_post.get("reach", 0)
    best_caption = top_post.get("caption", "")[:80]

    week_growth = sum(r.get("followers", 0) for r in growth[-7:]) - growth[-8].get("followers", 0) if len(growth) >= 8 else 0

    return f"""You are an Instagram growth strategist for @creator_demo, a Canadian beauty and skincare creator with ~26.4k followers.

ACCOUNT CONTEXT: The account recently transitioned from Spanish to English content. Current audience is legacy Latin American followers. Growth target is US and Canadian English-speaking audiences.

SEASONAL CONTEXT: {_get_season_context()}

This week's data snapshot:
- Top performing post: [{top_post.get('media_type', '')}] saves {top_saves:,}, shares {top_shares:,}, reach {top_reach:,}: "{best_caption}"
- Follower growth this week: +{week_growth} followers

Respond with a JSON object with exactly these four keys (each value is one concise sentence):
- "top_post": describe the top performing post focusing on its saves and shares — explain what made it worth saving or sharing
- "follower_growth": summarize this week's follower growth with context, noting the account is in transition from Spanish to English content
- "top_signal": highlight the single strongest content value signal this week — the best combination of saves, shares, or reach that shows what is resonating with the English-speaking target audience
- "priority_action": one specific, actionable priority for the next 7 days focused on growing US and Canadian followers

Be specific, encouraging, and actionable. Do not reference engagement rate. No revenue numbers."""


async def generate_hq_glance(posts: list[dict], growth: list[dict]) -> dict:
    if _settings.use_mock_data:
        return get_mock_hq_glance()

    message = _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": _build_hq_prompt(posts, growth)}],
    )

    parsed = parse_claude_json(message.content[0].text)
    return {
        "top_post": parsed["top_post"],
        "follower_growth": parsed["follower_growth"],
        "top_signal": parsed["top_signal"],
        "priority_action": parsed["priority_action"],
        "generated_at": datetime.utcnow().isoformat(),
    }


async def generate_insights(posts: list[dict], benchmarks: dict | None = None) -> dict:
    message = _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=3500,
        messages=[{"role": "user", "content": _build_prompt(posts, benchmarks)}],
    )

    parsed = parse_claude_json(message.content[0].text)

    return {
        "what_working":  parsed["what_working"],
        "what_flopping": parsed["what_flopping"],
        "briefing":      parsed["briefing"],
        "action_board":  parsed.get("action_board", []),
        "generated_at":  datetime.utcnow().isoformat(),
    }