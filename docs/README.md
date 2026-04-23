# Instagram Analytics Demo

Private Instagram analytics dashboard for **@creator_demo** — a beauty and skincare creator based in Toronto, Canada. Portfolio Project 6 by Moises Vivas.

## Dual Purpose

1. **Operational tool** — Demo Creator uses it daily to manage her Instagram content strategy, track growth, and plan posts.
2. **Proof-of-concept micro-SaaS** — architecture designed to eventually support multiple creators with Instagram OAuth, per-user token storage, and Stripe billing.

---

## What Is Live Today

| Tab | Status | Description |
|---|---|---|
| Overview | ✅ Live | 5 KPIs + WoW deltas + Transition Tracker + Daily Reach chart + Daily Spark |
| Posts | ✅ Live | 4-col grid, AI analysis per post (Haiku, cached, 2 calls/lifetime), sort + filter |
| AI Insights | ✅ Live | Claude Sonnet, 3 refreshes/week, cached in DB + Content Type Performance table |
| Action Board | ✅ Live | 7-post weekly plan (4 formats, 3+2+2), Claude Sonnet, 3 refreshes/week, 48h cache |
| HQ | ✅ Live | Pure SQL glance + real metrics |
| Headlines | 🔒 Hidden | Feature flag `SHOW_HEADLINES_TAB = false` — low-value without real trends API |
| Deals | 🔒 Hidden | Feature flag `SHOW_DEALS_TAB = false` — no backend yet |
| Calendar | ✅ Live | Inside Action Board — full CRUD, AI detail generation |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI 0.115 + Python 3.12 |
| ORM | SQLAlchemy 2.0 |
| Database | PostgreSQL (Railway) |
| Scheduler | APScheduler — auto-refresh every 30 min |
| AI | Claude Haiku (spark, post analysis) + Claude Sonnet 4.6 (insights, action board, ranking) |
| Instagram | Instagram Graph API v21.0 |
| Rate limiting | SlowAPI (60 req/min global) |
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS v4 (Dusty Mauve theme — primary #C4788A) |
| Auth | HTTP Basic Auth (all routes except `/api/health`) |
| Deploy | Railway (backend) + Vercel (frontend) |

---

## Deploy Instructions

> **Rule: CLI only. Never use GitHub, GitHub Actions, or any git-based CI/CD.**

```bash
# Backend
cd backend
railway up

# Frontend
cd frontend
vercel deploy --prod
```

---

## Local Development

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate      # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

Backend: `http://localhost:8000` | Frontend: `http://localhost:5173`

---

## Project Structure

```
instagram-analytics-demo/
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── CONTENT_STRATEGY.md
│   ├── BACKLOG.md
│   └── COSTS.md
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, auth middleware, scheduler
│   │   ├── config.py        # Settings + env var validation
│   │   ├── models.py        # SQLAlchemy models
│   │   ├── database.py      # DB session factory
│   │   ├── utils.py         # Shared utilities
│   │   ├── routers/         # One file per feature area
│   │   └── services/        # Business logic + Claude API calls
│   ├── requirements.txt
│   └── railway.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/tabs/ # One file per tab
│   │   ├── hooks/
│   │   ├── services/api.ts
│   │   └── types/index.ts
│   └── package.json
└── CLAUDE.md
```

---

## Security Model

- HTTP Basic Auth middleware on all endpoints except `/api/health`
- Brute-force: 15 failed attempts in 10 minutes → 10-minute IP block
- CORS: exact origin only, never wildcard
- All secrets in `.env` only — never in frontend code
- Instagram token and Anthropic key only accessible server-side
- Credentials stored in `sessionStorage` (not `localStorage`) — cleared on tab close
