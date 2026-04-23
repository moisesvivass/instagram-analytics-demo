"""
Generic mock data for @creator_demo — beauty/skincare creator, Canadian audience.
All values are plausible for a 45k-55k follower account with 2-8% engagement.
No real creator data is referenced here.
"""
import random
from datetime import datetime, timedelta

FOLLOWER_COUNT = 51_240
# BASE_DATE is captured once at process start; post timestamps are relative to it.
# Acceptable for mock data — Railway restarts the process on each deploy.
BASE_DATE = datetime.utcnow().replace(hour=12, minute=0, second=0, microsecond=0)


# --- Overview snapshot ---

def get_mock_overview() -> dict:
    return {
        "followers": FOLLOWER_COUNT,
        "reach_28d": 312_800,
        "profile_views": 8_940,
        "accounts_engaged": 24_510,
        "interactions": 41_320,
        "last_refreshed": BASE_DATE.isoformat(),
    }


def get_mock_growth() -> list[dict]:
    rng = random.Random(42)
    records = []
    followers = 43_800
    for i in range(90):
        day = BASE_DATE - timedelta(days=89 - i)
        followers += rng.randint(60, 220)
        records.append({"date": day.strftime("%Y-%m-%d"), "followers": followers})
    return records


def get_mock_reach_chart() -> list[dict]:
    rng = random.Random(42)
    records = []
    for i in range(28):
        day = BASE_DATE - timedelta(days=27 - i)
        base = 9_500 if day.weekday() < 5 else 14_200
        records.append({"date": day.strftime("%Y-%m-%d"), "reach": base + rng.randint(-1_500, 3_800)})
    return records


# --- Posts ---

_CAPTIONS = [
    "My current skincare routine has changed everything 🌿✨ Swipe to see each step! #skincare #glowup",
    "Partnership with @lumineskin — this serum is genuinely unreal. Full honest review on stories 🍃",
    "POV: me at 6am vs 10pm 😂 Both powered by SPF and a good cleanser #morningskincare",
    "Canadian winters are brutal on your skin. Here's what actually works 🇨🇦❄️ #dryskin",
    "Trying the viral TikTok slugging method so you don't have to 👀 #skincarehacks",
    "3 drugstore moisturizers under $20 that slap harder than luxury ones 💅 #budgetskincare",
    "Reel: my entire night routine start to finish — no cuts, no filter ✨",
    "The ingredient that changed my hyperpigmentation journey 🌟 #vitaminC #skincare",
    "Collab with @lumineskin — their new lip treatment is so good 💋 #bbpartner",
    "Hot take: you're probably using too much retinol. Here's how to fix it 🧴",
    "Glass skin tutorial — step by step, Canadian edition 🍁",
    "Cleanser ranking: I tested 12 so you don't have to 🧼 #cleansers #skincarereview",
]

_MEDIA_TYPES = ["REEL", "CAROUSEL_ALBUM", "IMAGE"]
_WEIGHTS = [0.45, 0.35, 0.20]

_THUMBNAILS = [
    "https://placehold.co/400x400/f8c8d4/2d2d2d?text=Reel+1",
    "https://placehold.co/400x400/d4e8c8/2d2d2d?text=Carousel+1",
    "https://placehold.co/400x400/c8d4f8/2d2d2d?text=Photo+1",
    "https://placehold.co/400x400/f8e8c8/2d2d2d?text=Reel+2",
    "https://placehold.co/400x400/e8c8f8/2d2d2d?text=Carousel+2",
    "https://placehold.co/400x400/c8f8e8/2d2d2d?text=Photo+2",
    "https://placehold.co/400x400/f8c8c8/2d2d2d?text=Reel+3",
    "https://placehold.co/400x400/f0e6d3/2d2d2d?text=Carousel+3",
    "https://placehold.co/400x400/d3e6f0/2d2d2d?text=Photo+3",
    "https://placehold.co/400x400/f0d3e6/2d2d2d?text=Reel+4",
    "https://placehold.co/400x400/e6f0d3/2d2d2d?text=Carousel+4",
    "https://placehold.co/400x400/d3f0e6/2d2d2d?text=Photo+5",
]

_COMMENTS = [
    ["Your skin is goals 😍", "What SPF do you use?", "I need this routine in my life!"],
    ["Obsessed with this collab ✨", "Just ordered it because of you!", "Does it work on sensitive skin?"],
    ["This is so relatable 😂", "Morning routines are everything", "Love your energy!"],
    ["Finally a Canadian skincare creator!", "Shipping to Quebec? 🇨🇦", "This is everything I needed"],
    ["The slugging method actually works!", "I tried this and wow", "You need to do a full tutorial"],
    ["Saving this for when I'm broke 😅", "$18 and it works better than my $80 cream??", "Link in bio?"],
    ["The no-cut thing is so refreshing 🙌", "Love your transparency!", "Best skincare reel this week"],
    ["Vitamin C changed my skin too!", "Which concentration do you use?", "Pairing with what moisturizer?"],
    ["@lumineskin is so underrated", "The lip treatment is amazing!", "Canadian brands > everything"],
    ["Okay but facts about retinol overuse", "I did this and broke out so bad 😭", "How much is too much?"],
    ["Glass skin is achievable 😭💕", "The layering technique!", "My skin is too dry for this"],
    ["Ranking these was so useful!", "The CeraVe ones are really good", "Which was the best overall?"],
]


def _build_posts() -> list[dict]:
    rng = random.Random(42)
    posts = []
    for i in range(12):
        media_type = rng.choices(_MEDIA_TYPES, weights=_WEIGHTS)[0]
        er = round(rng.uniform(0.022, 0.082), 4)
        reach = rng.randint(8_000, 42_000)
        likes = int(reach * er * rng.uniform(0.6, 0.9))
        comments = int(likes * rng.uniform(0.04, 0.12))
        saves = int(likes * rng.uniform(0.08, 0.25))
        shares = int(likes * rng.uniform(0.02, 0.10))
        days_ago = i * 2 + rng.randint(0, 1)
        # video_views: only for Reels — can exceed reach (repeat views)
        views = int(reach * rng.uniform(0.9, 1.35)) if media_type == "REEL" else None
        # impressions: always higher than reach (accounts for repeat views/surfaces)
        impressions = int(reach * rng.uniform(1.15, 1.60))
        posts.append({
            "post_id": f"mock_post_{i+1:03d}",
            "caption": _CAPTIONS[i],
            "media_type": media_type,
            "timestamp": (BASE_DATE - timedelta(days=days_ago)).isoformat(),
            "like_count": likes,
            "comments_count": comments,
            "reach": reach,
            "saved": saves,
            "shares": shares,
            "engagement_rate": er,
            "thumbnail_url": _THUMBNAILS[i],
            "comments": _COMMENTS[i],
            "views": views,
            "impressions": impressions,
        })
    return posts


_MOCK_POSTS: list[dict] = _build_posts()


def get_mock_posts() -> list[dict]:
    return _MOCK_POSTS


# --- Recent Comments ---

def _truncate_caption(caption: str, max_len: int = 55) -> str:
    return caption[:max_len] + "…" if len(caption) > max_len else caption


_COMMENT_AUTHORS = [
    "skincare_lover_ca", "glowgirl.to", "beautyby_sarah", "yourclearskin",
    "nataliebeauty_", "iamadri.ca", "cassieglows", "theskindiary",
    "toronto_beauty", "meghan_radiant",
]

# (post_index, comment_text, username_index, hours_ago, likes)
_RAW_COMMENTS = [
    (0, "Your skin is goals 😍 literally sending this to my sister", 0, 3, 24),
    (0, "What SPF do you use? I've been looking for a good one for Canadian winters!", 1, 8, 18),
    (1, "Just ordered it because of you! Hope it works on my combo skin 🙏", 2, 12, 31),
    (2, "This is so relatable 😂 morning me vs evening me is a different person", 3, 18, 15),
    (3, "Finally a Canadian skincare creator who actually gets the weather issue 🇨🇦", 4, 24, 42),
    (4, "I tried this last night and wow my skin feels completely different this morning", 5, 36, 67),
    (5, "$18 and it works better than my $80 cream?? Adding to cart NOW 😭", 6, 48, 89),
    (6, "The no-cut thing is so refreshing 🙌 other creators need to learn from this", 7, 60, 53),
    (7, "Vitamin C changed my skin too! Which concentration do you use with this?", 8, 72, 38),
    (8, "Been using the @lumineskin lip treatment for a week — my lips are obsessed", 9, 84, 29),
]


def _build_comments() -> list[dict]:
    comments = []
    for idx, (post_idx, text, author_idx, hours_ago, likes) in enumerate(_RAW_COMMENTS):
        post = _MOCK_POSTS[post_idx]
        ts = BASE_DATE - timedelta(hours=hours_ago)
        comments.append({
            "comment_id": f"mock_comment_{idx + 1:03d}",
            "username": _COMMENT_AUTHORS[author_idx],
            "text": text,
            "timestamp": ts.isoformat(),
            "post_id": post["post_id"],
            "post_caption": _truncate_caption(post["caption"]),
            "like_count": likes,
        })
    return sorted(comments, key=lambda c: c["timestamp"], reverse=True)


_MOCK_COMMENTS: list[dict] = _build_comments()


def get_mock_comments() -> list[dict]:
    return _MOCK_COMMENTS


# --- HQ Glance (static mock — real one comes from Claude) ---

def get_mock_audience_insights() -> dict:
    return {
        "target_market_reach_pct": 27.5,   # % of reach from US + CA
        "reel_reach_pct":          74.2,   # % of 28d reach that came from Reels
    }


def get_mock_reach_sources() -> dict:
    return {
        "reel_reach_pct": 74.2,
        "reel":     232_000,
        "story":     51_800,
        "carousel":  29_000,
        "total":    312_800,
    }


def get_mock_hq_glance() -> dict:
    return {
        "top_post": "6am vs 10pm routine Reel — 2.1K saves and 847 shares, the most-saved post this week at 38.4K reach.",
        "follower_growth": "+890 followers this week, above the 30-day average of +156/day.",
        "top_signal": "2,143 saves on the slugging method Reel — strongest content value signal this month, high utility content.",
        "priority_action": "Post one Reel this week with a spring skincare transition hook. Your audience responds best to seasonal relevance and Canadian-specific product recommendations.",
        "generated_at": BASE_DATE.isoformat(),
    }


def get_mock_format_performance() -> list[dict]:
    return [
        {"media_type": "REEL",           "label": "Reels",     "post_count": 28, "avg_saves": 14.2, "avg_shares": 9.1,  "avg_reach": 2840},
        {"media_type": "CAROUSEL_ALBUM", "label": "Carousels", "post_count": 14, "avg_saves": 8.6,  "avg_shares": 4.3,  "avg_reach": 1520},
        {"media_type": "IMAGE",          "label": "Static",    "post_count": 9,  "avg_saves": 2.1,  "avg_shares": 1.4,  "avg_reach": 870},
    ]


# --- AI Insights (static mock — real ones come from Claude) ---

def get_mock_insights() -> dict:
    return {
        "what_working": [
            {
                "title": "Daily routine Reels",
                "insight": "3x average saves: audiences bookmark routines to revisit step-by-step instructions later.",
                "next_step": "Film a Reel showing your full morning routine with product names on screen for each step.",
            },
            {
                "title": "Ingredient education",
                "insight": "High saves-to-reach ratio: ingredient explainers signal utility and get returned to repeatedly.",
                "next_step": "Post a carousel breaking down one hero ingredient per slide, ending with a Canadian drugstore pick.",
            },
            {
                "title": "Canadian specificity",
                "insight": "Posts with Canadian retailer context generate 2x shares vs account average.",
                "next_step": "Create a product ranking anchored to Shoppers Drug Mart or Sephora Canada availability.",
            },
        ],
        "what_flopping": [
            {
                "title": "Static single-product photos",
                "insight": "60% lower reach: no narrative hook means the algorithm does not surface them to new audiences.",
                "next_step": "Replace static product photos with a 3-slide carousel showing texture, application, and result.",
            },
            {
                "title": "Caption-only promotional posts",
                "insight": "Near-zero saves and shares: audiences do not save content that only promotes without teaching.",
                "next_step": "Add one actionable skincare tip to every promotional post before the brand mention.",
            },
        ],
        "briefing": (
            "**What the Numbers Mean**\n\n"
            "Saves and shares are the two signals that matter most on this account. "
            "Saves tell the algorithm your content is worth surfacing again because people want to return to it. "
            "Shares send your content to entirely new people outside your current following. "
            "Likes and comments confirm people saw the post, but they do not drive re-distribution the same way. "
            "The top posts on this account all have above-average saves and shares, not just high like counts.\n\n"
            "**Content Pattern**\n\n"
            "Educational routine content is consistently driving the strongest saves. "
            "The 6am vs 10pm Reel and the slugging method video both earned over 2x the account average in saves, "
            "suggesting audiences value step-by-step content they can follow along with.\n\n"
            "**Format Comparison: Reels vs Carousels**\n\n"
            "Reels average 1,840 saves and 620 shares on this account. "
            "Carousels average 1,210 saves and 390 shares. "
            "Reels drive more of both signals, suggesting video format is the primary growth lever. "
            "Carousels still earn strong saves for educational content and are worth maintaining for ingredient explainers.\n\n"
            "**Next Post Idea**\n\n"
            "Hook: 'I tested 5 Canadian SPF moisturizers for 30 days — here's the only one that doesn't pill under makeup.' "
            "Format: Reel (30s). Show texture swatches on skin for each product, rapid-cut comparison, final verdict with product names on screen. "
            "This combines two proven patterns: Canadian specificity and comparative format.\n\n"
            "**Brand Partnership Angle**\n\n"
            "The @lumineskin collab drove above-average engagement on this account. "
            "Canadian indie skincare brands with Sephora Canada placement are the strongest fit: "
            "target brands like Consonant Skincare or Graydon Skincare for a pitchable collab this week. "
            "Your saves-per-post data makes a strong case for product utility content, not awareness campaigns.\n\n"
            "**Road to 100k**\n\n"
            "At the current pace of roughly +156 followers per day, 100k is approximately 8 months away. "
            "The clearest accelerator in the current data is increasing Reel frequency from 2 to 3 per week, "
            "specifically using the routine and comparison formats that are already earning above-average saves and shares."
        ),
        "action_board": [
            "Post a Reel on Monday at 18:00 EST: spring skincare transition — swap your winter heavy cream for a lightweight SPF moisturizer, show texture comparison on skin",
            "Post a Carousel on Tuesday at 19:00 EST: side-by-side ranking of 4 Canadian SPF moisturizers under $35 with ingredient callouts and a final verdict slide",
            "Post a Reel on Wednesday at 18:00 EST: no-filter single-take morning routine focused on glass skin prep, show each product application step",
            "Post a Carousel on Thursday at 12:00 EST: niacinamide ingredient explainer — one slide per skin benefit, Canadian drugstore product recommendation on final slide",
            "Post a Reel on Friday at 19:00 EST: celebrity makeup detective — break down a trending celebrity look and identify the skincare prep underneath",
            "Post a Carousel on Saturday at 11:00 EST: myth-busting quiz carousel — true or false skincare questions, answer revealed on next slide, 8 slides total",
            "Post a Reel on Sunday at 20:00 EST: honest retinol overuse breakdown — signs you are using too much, how to cycle back safely, product recommendations",
        ],
        "generated_at": BASE_DATE.isoformat(),
    }


# --- Action Board (static mock — real one comes from Claude) ---

def get_mock_action_board() -> dict:
    return {
        "weekly_plan": [
            {
                "post_number": 1,
                "day": "Saturday",
                "time": "17:00",
                "format": "Reel (20-30s): before and after transformation",
                "hooks": [
                    "My skin looked like this 6 months ago. Here's exactly what changed it.",
                    "Honest 6-month glow-up: no filters, no edits, just skincare.",
                    "POV: you finally figured out your skin. Here's mine.",
                ],
                "content_angle": "Show a real before/after skin transformation with a step-by-step breakdown of the 3 products that made the biggest difference, all under $40 CAD.",
                "why_it_should_work": "Saturday at 5pm is the account's strongest posting slot. Before/after Reels consistently earn the most saves because viewers bookmark them to revisit the product list.",
                "target_metrics": {"saves": 320, "shares": 110, "reach_multiplier": 2.1},
                "confidence_score": 94,
            },
            {
                "post_number": 2,
                "day": "Tuesday",
                "time": "19:00",
                "format": "Carousel: product ranking",
                "hooks": [
                    "I tested 5 Canadian SPF moisturizers for 30 days. Here's the honest ranking.",
                    "5 SPFs, 5 weeks, 1 winner. Canada edition.",
                    "The only SPF ranking you need if you live in Canada.",
                ],
                "content_angle": "Side-by-side ranking of 5 Canadian SPF moisturizers under $35, with texture swatches, ingredient callouts, and a final verdict slide. Each slide = one product.",
                "why_it_should_work": "Ranking carousels are the account's top format for saves. Canadian-specific product selection drives strong comment engagement and shares from local followers.",
                "target_metrics": {"saves": 280, "shares": 95, "reach_multiplier": 1.7},
                "confidence_score": 89,
            },
            {
                "post_number": 3,
                "day": "Thursday",
                "time": "17:00",
                "format": "Reel (20-30s): celebrity makeup detective",
                "hooks": [
                    "This celebrity's makeup is secretly a skincare masterclass. Let me explain.",
                    "I analyzed Hailey Bieber's entire routine from red carpet photos. Here's what I found.",
                    "Her skin looks like this for a reason. Breaking it down.",
                ],
                "content_angle": "Use a trending celebrity look as the entry point, then break down the skincare prep underneath: likely products, technique, and how to replicate with drugstore alternatives.",
                "why_it_should_work": "Celebrity detective content has strong precedent in the beauty niche for driving shares. The cultural hook lowers the barrier to share with friends.",
                "target_metrics": {"saves": 190, "shares": 160, "reach_multiplier": 2.4},
                "confidence_score": 72,
            },
            {
                "post_number": 4,
                "day": "Wednesday",
                "time": "12:00",
                "format": "Carousel: myth-busting quiz",
                "hooks": [
                    "Most people get this skincare order wrong. Swipe to see if you do.",
                    "True or false: you should apply retinol before moisturizer. Swipe for the answer.",
                    "I asked 100 followers the same skincare question. Here's what everyone got wrong.",
                ],
                "content_angle": "Quiz-style carousel where each slide asks one common skincare myth (true/false), then reveals the answer on the next slide with a one-line explanation. 8 slides total, ends with a product recommendation.",
                "why_it_should_work": "Interactive quiz carousels are tested in the broader beauty niche but new for this account. The format encourages full carousel swipes, signaling strong content quality to the algorithm.",
                "target_metrics": {"saves": 210, "shares": 85, "reach_multiplier": 1.5},
                "confidence_score": 68,
            },
            {
                "post_number": 5,
                "day": "Sunday",
                "time": "10:00",
                "format": "Carousel: ingredient deep dive",
                "hooks": [
                    "Niacinamide does 6 things for your skin. Most people only know 2.",
                    "The ingredient that fixes 6 different skin concerns. One slide each.",
                    "Save this: the complete niacinamide guide for Canadian skin types.",
                ],
                "content_angle": "Educational deep dive on niacinamide: one slide per benefit (pores, hyperpigmentation, barrier, oil control, brightening, redness), with a Canadian drugstore product recommendation on the final slide.",
                "why_it_should_work": "High-utility educational carousels are the most saved content type in the beauty niche. This format works as evergreen content and drives consistent saves weeks after posting.",
                "target_metrics": {"saves": 380, "shares": 70, "reach_multiplier": 1.4},
                "confidence_score": 91,
            },
            {
                "post_number": 6,
                "day": "Monday",
                "time": "18:00",
                "format": "Reel (20-30s): spring skincare transition",
                "hooks": [
                    "Your winter skincare routine is ruining your spring skin. Here's why.",
                    "Time to swap out these 3 products. Spring edition.",
                    "The one product to drop as the weather warms up.",
                ],
                "content_angle": "Walk through which heavy winter products to swap out as weather warms, show lighter alternatives available at Shoppers Drug Mart, demonstrate texture difference on skin.",
                "why_it_should_work": "Seasonal transition content earns above-average saves because viewers use it as a reference checklist. Canadian-specific retailer mention increases relevance for the target audience.",
                "target_metrics": {"saves": 260, "shares": 100, "reach_multiplier": 1.8},
                "confidence_score": 85,
            },
            {
                "post_number": 7,
                "day": "Friday",
                "time": "19:00",
                "format": "Reel (15-20s): retinol correction",
                "hooks": [
                    "Signs you're using too much retinol (and what to do instead).",
                    "Retinol is breaking out your skin. Here's the fix.",
                    "Most people use retinol wrong. Here's the 30-second correction.",
                ],
                "content_angle": "Quick educational Reel identifying 3 signs of retinol overuse with a simple cycle-back protocol and a beginner-friendly product recommendation under $25 CAD.",
                "why_it_should_work": "Correction content drives strong shares because viewers forward it to friends they see making the same mistake. Short format (15-20s) increases completion rate and algorithm push.",
                "target_metrics": {"saves": 230, "shares": 130, "reach_multiplier": 2.0},
                "confidence_score": 88,
            },
        ]
    }


# --- Ranked Posts (static mock — real ones come from Claude) ---

_RANKING_LABELS = [
    "Top Performer", "Top Performer",
    "Strong", "Strong",
    "Average", "Average", "Average", "Average",
    "Needs Work", "Needs Work", "Needs Work", "Needs Work",
]
_RANKING_REASONS = [
    "High saves-to-reach ratio: educational content the audience bookmarks to return to.",
    "Above-average shares amplify organic reach beyond current followers.",
    "Strong saves and reach combination: Reel format working well for this topic.",
    "Solid engagement driven by a clear hook in the opening caption line.",
    "Average metrics: improving the opening hook could increase saves significantly.",
    "Moderate reach: adding a clear call to action could lift saves.",
    "Average performance: testing a different format could improve results.",
    "Low saves relative to reach: content was seen but not perceived as worth saving.",
    "Few shares: content does not invite forwarding to friends.",
    "Low reach and saves: topic did not resonate with the target audience.",
    "Weak hook detected: the first line does not create scroll-stopping curiosity.",
    "Generic content without a clear differentiator for the Canadian beauty audience.",
]


def _build_mock_ranked() -> list[dict]:
    sorted_posts = sorted(_MOCK_POSTS, key=lambda p: p["saved"] + p["shares"], reverse=True)
    return [
        {
            "rank_position": i + 1,
            "post_id": post["post_id"],
            "score_label": _RANKING_LABELS[i],
            "reasoning": _RANKING_REASONS[i],
            "caption": post["caption"],
            "media_type": post["media_type"],
            "timestamp": post["timestamp"],
            "like_count": post["like_count"],
            "comments_count": post["comments_count"],
            "reach": post["reach"],
            "saved": post["saved"],
            "shares": post["shares"],
            "engagement_rate": post["engagement_rate"],
            "thumbnail_url": post["thumbnail_url"],
        }
        for i, post in enumerate(sorted_posts)
    ]


_MOCK_RANKED: list[dict] = _build_mock_ranked()


def get_mock_ranked_posts() -> dict:
    return {
        "ranked": True,
        "posts": _MOCK_RANKED,
        "generated_at": BASE_DATE.isoformat(),
        "source": "mock",
        "calls_used": 0,
        "calls_max": 3,
    }


# --- Headlines (static mock) ---

def get_mock_headlines() -> list[dict]:
    return [
        {
            "title": "Instagram Tests New Creator Monetization Tools for Stories",
            "source": "Social Media Today",
            "summary": "Meta is rolling out expanded monetization features for Instagram creators, including subscription stickers and enhanced brand partnership tools in Stories.",
            "url": "https://www.socialmediatoday.com",
            "fetched_at": BASE_DATE.isoformat(),
        },
        {
            "title": "TikTok's New Algorithm Shift Could Benefit Instagram Reels Creators",
            "source": "TechCrunch",
            "summary": "As TikTok faces regulatory uncertainty, analysis shows Instagram Reels engagement up 18% among creators who primarily post beauty and lifestyle content.",
            "url": "https://techcrunch.com",
            "fetched_at": BASE_DATE.isoformat(),
        },
        {
            "title": "Canadian Creator Economy Grew 34% in 2025, Report Finds",
            "source": "Social Media Today",
            "summary": "A new report highlights Canada as one of the fastest-growing creator economies, with beauty and wellness being the top-performing niches.",
            "url": "https://www.socialmediatoday.com",
            "fetched_at": BASE_DATE.isoformat(),
        },
        {
            "title": "Meta Announces Updated Instagram Insights Dashboard for Business Accounts",
            "source": "TechCrunch",
            "summary": "Instagram's revamped analytics dashboard now includes 90-day reach trends and improved demographic breakdowns for creator accounts.",
            "url": "https://techcrunch.com",
            "fetched_at": BASE_DATE.isoformat(),
        },
        {
            "title": "Skincare Creators See 22% Higher Engagement Than Average Beauty Accounts",
            "source": "Social Media Today",
            "summary": "Educational skincare content continues to dominate Instagram engagement metrics, with routine walkthroughs and ingredient explainers leading saves and shares.",
            "url": "https://www.socialmediatoday.com",
            "fetched_at": BASE_DATE.isoformat(),
        },
    ]
