"""
RSS feed parser for creator industry news.
Falls back to mock data if USE_MOCK_DATA=true or feeds fail.
"""
import asyncio
import re
from datetime import datetime

import httpx
import xml.etree.ElementTree as ET

from app.config import get_settings
from app.services.mock_data import get_mock_headlines

RSS_FEEDS = [
    ("Social Media Today",    "https://www.socialmediatoday.com/rss/"),
    ("Later Blog",            "https://later.com/blog/feed/"),
    ("Creator Economy Report","https://www.creatoriq.com/blog/rss"),
    ("WWD Beauty",            "https://wwd.com/beauty-industry-news/feed/"),
    ("Allure",                "https://www.allure.com/feed/rss"),
    ("Vogue Business",        "https://www.voguebusiness.com/rss"),
    ("The Beauty Independent","https://www.beautyindependent.com/feed/"),
]

_FEED_ITEMS_PER_SOURCE = 20
_SUMMARY_MAX_LEN       = 300
_RESULTS_CAP           = 10

CREATOR_KEYWORDS = [
    # Platform & algorithm
    "instagram", "tiktok", "reels", "algorithm", "reach", "engagement",
    # Creator economy
    "creator", "influencer", "brand deal", "sponsorship", "ugc",
    "creator economy", "monetiz", "content creator",
    # Beauty & skincare
    "skincare", "beauty", "serum", "retinol", "spf", "sunscreen",
    "moisturiz", "cleanser", "toner", "hyaluronic", "niacinamide",
    "collagen", "vitamin c", "aha", "bha", "exfoliat",
    "lip", "mascara", "foundation", "blush", "eyeshadow",
    "makeup", "cosmetic", "fragrance", "haircare",
    # Canadian market
    "canada", "canadian", "sephora canada",
    # Trends & launches
    "product launch", "new launch", "trending", "viral", "ingredient",
    "clean beauty", "sustainable beauty", "indie brand",
]


def _is_relevant(title: str, summary: str) -> bool:
    combined = (title + " " + summary).lower()
    return any(kw in combined for kw in CREATOR_KEYWORDS)


def _parse_feed(source: str, xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    if channel is None:
        return []

    items = []
    for item in channel.findall("item")[:_FEED_ITEMS_PER_SOURCE]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        description = (item.findtext("description") or "").strip()
        description = re.sub(r"<[^>]+>", "", description)[:_SUMMARY_MAX_LEN]

        if title and link and _is_relevant(title, description):
            items.append({
                "title": title,
                "source": source,
                "summary": description,
                "url": link,
                "fetched_at": datetime.utcnow().isoformat(),
            })
    return items


async def fetch_headlines() -> list[dict]:
    settings = get_settings()
    if settings.use_mock_data:
        return get_mock_headlines()

    async def _fetch(client: httpx.AsyncClient, source: str, url: str) -> list[dict]:
        try:
            r = await client.get(url, follow_redirects=True)
            r.raise_for_status()
            return _parse_feed(source, r.text)
        except Exception:
            # Skip unavailable feeds without logging sensitive URLs
            return []

    async with httpx.AsyncClient(timeout=8.0) as client:
        batches = await asyncio.gather(
            *[_fetch(client, source, url) for source, url in RSS_FEEDS]
        )

    results = [item for batch in batches for item in batch]

    if not results:
        return get_mock_headlines()

    return results[:_RESULTS_CAP]
