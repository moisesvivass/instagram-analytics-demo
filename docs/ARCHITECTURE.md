# Architecture — Instagram Analytics Demo

## System Overview

```
Browser
  └── React SPA (Vercel)
        │  HTTP Basic Auth header on every request
        │
        ▼
  FastAPI (Railway)
        ├── Auth middleware (all routes)
        ├── SlowAPI rate limiter (60 req/min)
        ├── APScheduler (auto-refresh every 30 min)
        │
        ├── /api/instagram/*   ──► Instagram Graph API v21.0
        ├── /api/insights/*    ──► Claude Sonnet + PostgreSQL cache
        ├── /api/action-board  ──► Claude Sonnet + PostgreSQL cache
        ├── /api/posts/ranked  ──► Claude Sonnet + PostgreSQL cache
        ├── /api/calendar/*    ──► PostgreSQL only
        ├── /api/headlines     ──► 7 RSS feeds (httpx)
        ├── /api/admin/*       ──► CSV import (PostgreSQL)
        └── /api/health        ──► No auth required
              │
              ▼
        PostgreSQL (Railway)
```

---

## Data Flow: Page Load

1. React app checks `sessionStorage` for `yy_auth` (Base64 `user:pass`)
2. If missing → `LoginScreen` collects credentials, stores in `sessionStorage`
3. Every `apiFetch()` call adds `Authorization: Basic <token>` header
4. FastAPI middleware decodes and validates credentials on every request
5. On 401 → `sessionStorage` cleared, page reloads to login

---

## API Endpoints

### Instagram — `/api/instagram`

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | Followers, 28D reach, profile views, accounts engaged, interactions. Includes WoW deltas computed from `InstagramSnapshot` history. |
| GET | `/posts` | All posts with metrics. `?sort_by=date\|performance\|reach\|saved\|shares`. Performance score computed server-side: `(shares×4 + saves×3) × log(reach+1)`. |
| GET | `/reach-chart` | 28-day daily reach array. |
| GET | `/growth` | Follower count time series. |
| GET | `/comments` | Latest comments across all posts. |
| GET | `/this-week` | 4 metrics: shares, saves, reach, posts (current week). |

### AI Insights — `/api/insights`

| Method | Path | Description |
|---|---|---|
| GET | `/latest` | Latest cached insights (mock or real). Returns `calls_used` / `calls_max`. |
| POST | `/generate` | Force-generate new insights. Blocked at 3 real calls/week. |
| GET | `/hq-glance` | 4-sentence HQ briefing. 48h cache. Rate limited to 3/week. |
| GET | `/format-performance` | Avg saves/shares/reach per content format. |

### Action Board — `/api/action-board`

| Method | Path | Description |
|---|---|---|
| GET | `` | Latest 7-post weekly plan. 48h cache. Auto-generates on first call. |
| POST | `/generate` | Bypass 48h cache and force a fresh plan. Still enforces 3/week limit. |

### Posts Ranking — `/api/posts`

| Method | Path | Description |
|---|---|---|
| GET | `/ranked` | Claude Sonnet-ranked posts. 48h cache. 3 calls/week limit. |

### Calendar — `/api/calendar`

| Method | Path | Description |
|---|---|---|
| GET | `` | All calendar posts ordered by date. |
| POST | `` | Create a new calendar post. |
| PUT | `/{id}` | Update a calendar post. |
| DELETE | `/{id}` | Delete a calendar post. |
| POST | `/generate-details` | AI-generated opening script, products, hashtags, and duration for a post idea. |

### Headlines — `/api/headlines`

| Method | Path | Description |
|---|---|---|
| GET | `/headlines` | Filtered news from 7 RSS feeds. Falls back to mock data. |

### Admin — `/api/admin`

| Method | Path | Description |
|---|---|---|
| POST | `/import-csv` | Import historical posts from Meta Business Suite CSV export. |
| GET | `/snapshots` | Debug endpoint: snapshot count and date range. |

### System

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check. No auth required. Used by Railway. |
| POST | `/api/refresh` | Force-refresh Instagram data (overview + posts + reach chart). |

---

## Database Schema

### `instagram_snapshots`
Stores follower/reach/engagement data every 30 minutes (written by APScheduler). Used for WoW delta calculations.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| followers | Integer | |
| reach | Integer | 28D reach |
| impressions | Integer | Currently always 0 |
| engaged_accounts | Integer | |
| interactions | Integer | |
| profile_views | Integer | |
| captured_at | DateTime | UTC |

### `posts`
Live posts fetched from Instagram Graph API and synced on each refresh.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| post_id | String(64) UNIQUE | Instagram media ID |
| caption | Text | |
| media_type | String(20) | `REEL`, `CAROUSEL_ALBUM`, `IMAGE` |
| timestamp | DateTime | Post publish time |
| like_count | Integer | |
| comments_count | Integer | |
| reach | Integer | |
| saved | Integer | |
| shares | Integer | |
| engagement_rate | Float | |
| thumbnail_url | Text | May expire — frontend shows fallback |

### `csv_posts`
Historical posts imported from Meta Business Suite CSV exports. Merged with live posts for AI analysis.

| Column | Type | Notes |
|---|---|---|
| post_id | String(64) PK | |
| account_username | String(100) | |
| description | Text | Caption |
| duration_sec | Integer | |
| publish_time | DateTime | |
| permalink | Text | |
| post_type | String(30) | |
| views / reach / likes / shares / follows / comments / saves | Integer | |
| imported_at | DateTime | UTC |

### `ai_insights`
Cached AI Insights and HQ Glance results.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| what_working | Text | JSON array of `{title, insight, next_step}` objects |
| what_flopping | Text | JSON array of `{title, insight, next_step}` objects |
| briefing | Text | Markdown strategy briefing |
| action_board | Text | Legacy field — real data in `action_board_cache` |
| generated_at | DateTime | UTC |
| source | String(10) | `mock` or `real` |

### `action_board_cache`
Cached Action Board weekly plans.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| items | Text | JSON array of 7 `ActionBoardPost` objects |
| generated_at | DateTime | UTC |
| source | String(10) | `mock` or `real` |

### `post_rankings`
Claude Sonnet-generated post rankings.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| post_id | String(64) | References `posts.post_id` |
| rank_position | Integer | 1 = best |
| score_label | String(50) | `Top Performer`, `Strong`, `Average`, `Needs Work` |
| reasoning | Text | One sentence |
| generated_at | DateTime | Shared across all rows in a batch |
| source | String(10) | `mock` or `real` |

### `calendar_posts`
User-created content calendar entries.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| title | String(200) | |
| date | Date | |
| time_slot | String(20) | e.g. `18:00` |
| content_type | String(30) | |
| status | String(20) | `Idea`, `Scheduled`, `Published` |
| hook | Text | |
| notes | Text | |
| opening_script | Text | AI-generated |
| products_to_mention | Text | JSON array string |
| hashtags | Text | JSON array string |
| recommended_duration | String(20) | e.g. `20-30s` |
| created_at / updated_at | DateTime | UTC |

---

## Claude API Usage Map

| Feature | Model | Max tokens | Rate limit | Cache TTL |
|---|---|---|---|---|
| AI Insights | claude-sonnet-4-6 | 3,500 | 3/week | Until next manual refresh |
| Action Board | claude-sonnet-4-6 | 4,500 | 3/week | 48 hours |
| HQ Glance | — (pure SQL now) | — | — | 24h |
| Post Ranking | claude-sonnet-4-6 | 2,000 | 3/week | 48 hours |
| Calendar Details | claude-sonnet-4-6 | 600 | None | None (on-demand) |
| Daily Spark | claude-haiku-4-5 | — | 1/day | localStorage (24h) |
| Post Analysis | claude-haiku-4-5 | — | 2/post lifetime | DB (permanent) |

### Rate Limit Enforcement Pattern

1. Count rows where `source = 'real'` and `generated_at >= Monday 00:00 UTC`
2. If count < 3 and cache is fresh (< 48h): return cached result
3. If count < 3 and cache is stale: generate fresh, save to DB, return
4. If count >= 3 and stale cache exists: return stale cache with `X-Cache: stale` header
5. If count >= 3 and no cache: return HTTP 429 with `resets_at` field

---

## Scheduled Jobs

APScheduler runs inside the FastAPI process. One job:

- **`refresh_job`** — every 30 minutes
  - Calls `fetch_overview()`, `fetch_posts()`, `fetch_reach_chart()` in parallel
  - Writes one `InstagramSnapshot` row to the DB

---

## Authentication Details

HTTP Basic Auth is implemented as a FastAPI middleware (not a dependency).

- Credentials compared with `secrets.compare_digest` (constant-time)
- Brute-force: 15 failures in 10-minute window → 10-minute IP block
- Block state is in-memory — resets on process restart
- `/api/health` and `OPTIONS` preflight requests bypass auth

---

## Future Architecture (SaaS)

- Replace HTTP Basic Auth with per-user session tokens or JWT
- Store Instagram access tokens encrypted per user row in DB
- Replace hardcoded `INSTAGRAM_BUSINESS_ACCOUNT_ID` with user-scoped config
- Add Instagram OAuth flow for self-serve onboarding
- Add Stripe webhooks for subscription management
- Extract APScheduler to a separate worker process
