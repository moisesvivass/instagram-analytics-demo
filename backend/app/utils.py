import json
from datetime import datetime, timedelta


def post_weighted_score(post: dict) -> int:
    # Shares (≈ DM sends) weighted 2x over saves: Instagram 2026 algorithm weights
    # sends 3-5x more than likes for non-follower distribution, making shares the
    # primary growth signal over saves.
    return post.get("shares", 0) * 2 + post.get("saved", 0)


def week_start_utc() -> datetime:
    now = datetime.utcnow()
    return (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def next_monday_iso() -> str:
    return (week_start_utc() + timedelta(weeks=1)).isoformat() + "Z"


def parse_claude_json(text: str) -> dict | list:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)
