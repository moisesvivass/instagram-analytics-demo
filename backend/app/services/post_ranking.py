import anthropic

from app.config import get_settings
from app.utils import parse_claude_json

_settings = get_settings()
_client = anthropic.Anthropic(api_key=_settings.anthropic_api_key)


def _build_ranking_prompt(posts: list[dict]) -> str:
    lines = []
    for p in posts:
        caption = (p.get("caption") or "")[:200]
        lines.append(
            f'post_id: {p["post_id"]} | [{p["media_type"]}] | '
            f'Saves: {p["saved"]:,} | Shares: {p["shares"]:,} | '
            f'Reach: {p["reach"]:,} | Likes: {p["like_count"]:,} | '
            f'Comments: {p["comments_count"]:,}\n'
            f'  Caption: "{caption}"'
        )
    posts_block = "\n\n".join(lines)
    n = len(posts)

    return f"""You are an Instagram analytics expert advising a Canadian beauty and skincare creator with ~50k followers.

Rank the following {n} posts from best to worst real-world performance.
Primary signal (most important): Shares/DM sends — Instagram 2026 algorithm weights sends per reach 3-5x more than likes for reaching new audiences. A post that gets sent via DM gets pushed to non-followers.
Secondary signal: Saves — content worth returning to, drives follower retention and repeat visits.
Tertiary signals: reach, likes, comments.
Consider caption quality, format, and topic relevance for a US/Canadian beauty audience.

POSTS:
{posts_block}

Return ONLY the JSON array. No extra text. No markdown. No explanations.

Return a JSON array with exactly {n} objects ordered from rank 1 (best) to rank {n} (worst):

[
  {{
    "rank_position": 1,
    "post_id": "...",
    "score_label": "Top Performer",
    "reasoning": "One sentence in English, max 15 words, explain the key signal that drives the rank."
  }}
]

score_label must be exactly one of: "Top Performer", "Strong", "Average", "Needs Work".
reasoning: one sentence in English, max 15 words, explain the key signal that drives the rank (prioritize shares/sends over saves)."""


async def generate_ranking(posts: list[dict]) -> list[dict]:
    message = _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": _build_ranking_prompt(posts)}],
    )
    return parse_claude_json(message.content[0].text)
