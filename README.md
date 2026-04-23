# Instagram Analytics Demo

A full-stack AI-powered analytics dashboard for Instagram content creators.

> **This is a demo version with synthetic data.**
> The original is a **private production tool** built for a real content creator with 26K+ Instagram followers (50K+ across all platforms). It is actively used weekly to drive content strategy and is being expanded to cover YouTube and TikTok. This repository exists for portfolio purposes only — the real product is not open source.

**Live demo:** [instagram-demo-gold.vercel.app](https://instagram-demo-gold.vercel.app)  
*(No login required — auto-authenticates on load)*

---

## What It Does

Replaces manual Instagram tracking with automated data collection, AI-generated insights, and a weekly content planning system.

| Tab | What it shows |
|---|---|
| **Overview** | 5 KPIs with week-over-week deltas, reach chart, follower transition tracker, daily AI spark |
| **Posts** | Full post grid with AI analysis per post — engagement scoring, pattern detection |
| **AI Insights** | Claude-generated weekly brief: what's working, what's not, actionable strategy |
| **Action Board** | AI-generated 7-post weekly content plan with format types and retailer anchors |
| **HQ** | Pure SQL analytics — no AI, raw metrics for power users |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | FastAPI 0.115 + Python 3.12 + SQLAlchemy 2.0 + PostgreSQL |
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui |
| **AI** | Claude Haiku (post analysis, daily spark) + Claude Sonnet (insights, action board, ranking) |
| **Data** | Instagram Graph API v21.0 |
| **Scheduler** | APScheduler — automated data refresh every 30 min |
| **Auth** | HTTP Basic Auth with brute-force protection (15 failures / 10 min → 10 min block) |
| **Rate Limiting** | SlowAPI on all Claude-backed endpoints |
| **Deploy** | Railway (backend) + Vercel (frontend) |

---

## Architecture

```
Instagram Graph API
        │
        ▼
  FastAPI Backend ──── Claude API (Sonnet + Haiku)
        │
   PostgreSQL
        │
  React Frontend
```

- All external API calls go through the backend — never from the frontend
- Claude API is rate-limited (3 generations/week for major features, results cached in DB)
- `USE_MOCK_DATA=true` serves synthetic data — no real API keys needed to run locally

---

## Running Locally

### Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Create `backend/.env`:
```
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/instagram_demo
BASIC_AUTH_USER=demo
BASIC_AUTH_PASSWORD=demo2026
ALLOWED_ORIGIN=http://localhost:5173
ENVIRONMENT=development
USE_MOCK_DATA=true
INSTAGRAM_ACCESS_TOKEN=DEMO_TOKEN
INSTAGRAM_BUSINESS_ACCOUNT_ID=DEMO_ACCOUNT_ID
ANTHROPIC_API_KEY=your_key_here
```

Create `frontend/.env`:
```
VITE_API_BASE_URL=http://localhost:8001
VITE_DEMO_USER=demo
VITE_DEMO_PASSWORD=demo2026
```

---

## Development Workflow — Claude Code

This project was built entirely using **[Claude Code](https://claude.ai/code)** as the primary development environment — an agentic coding workflow that goes well beyond autocomplete.

### CLAUDE.md
A `CLAUDE.md` file lives at the root of every project. Claude Code reads it at the start of every session. It contains the full stack reference, file map, security rules, deploy instructions, Claude API usage map, known technical debt, and coding conventions. This eliminates context re-explanation across sessions and keeps every decision grounded in the actual project state.

### Custom Skills (Slash Commands)
Three reusable skills were built for this project:

| Skill | What it does |
|---|---|
| `/deploy` | Runs pre-flight git checks, then `railway up` + `vercel deploy --prod` in the correct order |
| `/new-feature` | Checks git state, suggests a conventional-commit branch name, creates and switches to it |
| `/reset-rate-limit` | Shifts this week's AI generation timestamps back 8 days so the weekly counter resets without deleting cached content |

### Prompt Tester Sub-Agent
A custom sub-agent was built to test Claude prompt modifications safely before committing:

- Pulls real post data directly from the production database
- Runs the **current prompt (baseline)** and the **modified prompt** against the same data
- Produces a structured comparison report with a `SHIP IT / NEEDS WORK / REVERT` recommendation
- Never modifies source files or consumes a weekly rate limit token

This made it safe to iterate on the Action Board and AI Insights prompts across multiple versions without risking the production weekly generation budget.

---

## Security

- No secrets in frontend — all API calls go through the backend
- HTTP Basic Auth on every endpoint except `/api/health`
- Brute-force protection: 15 failures in 10 min → 10 min IP block
- CORS: exact origin only, never wildcard
- Rate limiting via SlowAPI on all Claude-backed endpoints
- All secrets from environment variables — never hardcoded

---

## Project Structure

```
instagram-analytics-demo/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, auth middleware, brute-force protection, scheduler
│   │   ├── config.py            # Settings + env var validation
│   │   ├── models.py            # SQLAlchemy models
│   │   ├── routers/             # One router per feature area
│   │   │   ├── instagram.py     # Overview + reach chart
│   │   │   ├── posts.py         # Post grid + AI analysis
│   │   │   ├── insights.py      # Weekly AI brief
│   │   │   ├── action_board.py  # Weekly content plan
│   │   │   ├── spark.py         # Daily Spark
│   │   │   └── tracker.py       # Follower transition tracker
│   │   └── services/            # Business logic + Claude API calls
│   │       ├── mock_data.py     # Synthetic data (USE_MOCK_DATA=true)
│   │       ├── ai_insights.py   # Claude Sonnet — insights prompt
│   │       ├── action_board.py  # Claude Sonnet — action board prompt
│   │       └── post_ranking.py  # Claude Sonnet — engagement scoring
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Root: tabs, header, auto-login, refresh
│   │   ├── components/tabs/     # One component per tab
│   │   ├── services/api.ts      # All API calls — never in components
│   │   ├── hooks/useApi.ts      # Generic fetch hook
│   │   └── types/index.ts       # All TypeScript interfaces
│   └── package.json
└── README.md
```

---

Built by [Moises Vivas](https://linkedin.com/in/moisesvivas)
