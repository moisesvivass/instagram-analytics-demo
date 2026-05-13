# Instagram Analytics Demo — Claude Reference

## 0. About This Repository

Public portfolio repository. Showcases the full architecture of a creator-analytics dashboard: FastAPI + PostgreSQL + React + Claude AI.

The same architecture runs in production for a real Instagram creator under a private repo. **This repo exists to demonstrate engineering decisions, not anyone's real account data.**

- Demo creator: `@creator_demo` (fictitious — beauty/skincare, Canadian audience)
- Demo mode: `USE_MOCK_DATA=true` — no Instagram or Claude API calls hit real services
- Live demo: https://instagram-demo-gold.vercel.app (auto-login, no password screen)

Every number in this file under "Demo Profile" comes from `services/mock_data.py`. They are plausible figures, not measured behavior.

---

## 1. Mission

A weekly operating system for an Instagram creator: AI Insights, Action Board (7-post weekly plan), post ranking, follower transition tracker, content calendar.

The product optimizes for **English-speaking North American audience**. The decisions, prompts, and signal contract assume that target — they are not generic.

> Detailed docs: `docs/` (architecture diagrams + feature specs)

---

## 2. Hard Rules — Non-Negotiable

**Deploy — CLI only. Never GitHub, never CI/CD.**
```
backend:  cd backend && railway up
frontend: cd frontend && vercel deploy --prod
```
Pushing to remote is version control only. It does not deploy.

**Branch — always before touching code.**
```
git checkout -b type/description   # feat/ fix/ refactor/ chore/ docs/
```
Never work directly on `master`.

**Secrets — never in code.**
All keys live in `.env`. The `check_secrets.sh` hook blocks commits containing API keys or tokens. If it fires, fix the staged diff — do not bypass with `--no-verify`.

**Database — never modify models or run migrations without explicit user approval.**
Show the migration plan and wait for confirmation before touching `models.py` or running Alembic.

**No backup files.** Never create `-backup`, `-old`, or personal-name variants.

---

## 3. Cost & Rate Budget

Single-user target: **≤ $2/month total Claude API spend.** A feature that breaks this does not merge.

| Feature | Model | Limit | Output tokens | Cache |
|---|---|---|---|---|
| AI Insights | claude-sonnet-4-6 | 3 calls/week | 3,500 | Until next refresh |
| Action Board | claude-sonnet-4-6 | 3 calls/week | 4,500 | 48h + prompt caching |
| Post Ranking | claude-sonnet-4-6 | 3 calls/week | 2,000 | 48h |
| Calendar Details | claude-sonnet-4-6 | On-demand | 600 | None |
| HQ Glance | Pure SQL | — | — | 24h |
| Daily Spark | claude-haiku-4-5 | 1/day | — | localStorage 24h |
| Post Analysis | claude-haiku-4-5 | 2/post lifetime | — | DB permanent |

Limits counted from Monday 00:00 UTC. Pattern: rows where `source='real'` and `generated_at >= Monday 00:00 UTC`.

In demo mode (`USE_MOCK_DATA=true`) **no real Claude calls are made** — AI sections return cached fixture responses.

**Prompt caching is mandatory** for any Sonnet feature called ≥ 2x/week with a static block ≥ 1,024 tokens. Action Board already implements this:
- `_STATIC_PROMPT`: account rules, format definitions, JSON schema — `cache_control: ephemeral`. Calls 2 and 3 of the week get a cache hit (~70% token savings).
- `_build_dynamic_prompt()`: seasonal context, post performance, weekly memory — fresh every call.

**Rate limit reset is a signal, not a solution.** The `/reset-rate-limit` skill exists for emergencies. Hitting it > 2x/week means the prompt is unstable — fix the prompt, do not raise the limit.

**Model migration policy:**
- Action Board stays on Sonnet. Haiku produces generic recommendations for complex strategy tasks.
- Post Ranking and Calendar Details are candidates for Haiku migration — test with the `prompt-tester` agent first.
- HQ Glance is pure SQL. Do not regress to an AI call.
- Migration to Haiku only matters at 50+ users. At 1 user the saving is < $1.50/month.

---

## 4. The Signal Contract

**One formula, one place.** `post_weighted_score()` in `backend/app/utils.py`.

```python
score = shares * 2 + saved
```

Shares weighted 2x: DM sends are the primary growth driver (Instagram 2026 algorithm).
Saves weighted 1x: content worth returning to, signals utility to the algorithm.
Never use engagement rate — it is inversely correlated with reach.

**Performance labels (server-side):**

| Label | Condition |
|---|---|
| `winner` | reach ≥ avg AND (shares + saves) ≥ 5 |
| `promising` | reach < avg AND (shares + saves) ≥ 5 |
| `underperformer` | reach ≥ avg AND (shares + saves) < 5 |
| `neutral` | reach < avg AND (shares + saves) < 5 |

The threshold of 5 combined shares+saves is a deliberate floor: below that, signal is too noisy to label.

---

## 5. Format Confidence Ladder

The four content formats Action Board recommends. Each format must accumulate **n ≥ 5 posts above account average** before new rules or weights are codified.

**Canadian retailer anchors — pick whichever applies, not assigned per format:**
Sephora Canada · Shoppers Drug Mart · Walmart Canada · Chatters

---

**A — Celebrity ID + Real Product**
Identify the exact product a celebrity wore at a visible, recent event. Name the product. Link to a Canadian retailer.

**Critical rule — 48h trending window.** Format A works because the celebrity is actively trending. After 48h the algorithmic tailwind disappears. Do not publish a Format A post about an event that ended more than 3 days ago.

**B — Celebrity ID + Dupe**
Same celebrity detective angle, but find the affordable dupe at a Canadian retailer. The luxury-vs-affordable contrast is the hook. High share rate — viewers forward to friends.

**C — Hack Universal**
A beauty or skincare technique that works for anyone regardless of budget, skin type, or location. No retailer anchor required. Drives shares because people send these to their circle.

**D — Curation Local**
Product roundup anchored to Canadian retailers. Drives saves as a shopping reference.

---

**Anti-patterns — never recommend:**
- Single product showcase with no hook (consistently 0 shares / 0 saves)
- Generic review framing: "holy grail", "must-have", "obsessed with this"
- Personal/lifestyle content without a beauty hook
- Format A published > 72h after the trending event

---

## 6. Action Board Contract

Generates exactly **7 posts per week**. Composition is non-negotiable:
- 3 LOCAL posts: formats A, B, or D with a Canadian retailer anchor
- 2 UNIVERSAL posts: format C (different angles)
- 2 FLEX posts: highest confidence, any format

**Posting window:** 18:00–19:00 EST. Vary exact minutes — never the same time every day.
**Trial Reels:** 2-3 per week at 13:00 EST. Shows to non-followers first. Primary tool to reset audience composition.
**Cold Streak rule:** Reel < 1,000 views in 10h → do NOT promote via Stories.

**Preemption rule — trending moments override the weekly plan.** If a major celebrity moment breaks during the week, drop one FLEX slot and replace it with a Format A post within 48h. Do not wait for the next weekly generation.

**Memory:** the router injects the last 2 weekly plans into the prompt. Claude must not repeat the same celebrity + event + product combination across the previous 2 weeks.

---

## 7. Transition Tracker

Designed for accounts in language/audience transition (e.g. Spanish-speaking Latin American base → English-speaking US/Canadian).

**Net follower growth ≈ 0 is NOT failure during transition.** It means: legacy followers leaving ≈ target-market followers arriving. Flat follower count must not be interpreted as broken conversion.

**Metrics that matter during transition:**
- `target_market_reach_pct` — % reach from the target geography (trending up = transition working)
- `non_follower_reach_pct` — Trial Reels reaching new people
- 28D reach — algorithmic distribution
- Monthly avg shares/saves — content quality signal

**What does NOT matter yet:** net follower count, follower growth rate, follow conversion rate.

**Minimum evaluation horizon: 6 months** from dashboard launch. Three weeks of data is noise.

---

## 8. Demo Profile (mock data, not measured)

All values come from `backend/app/services/mock_data.py`. **These are plausible figures for a 45-55k follower beauty/skincare account, not real measurements.**

| Metric | Mock value |
|---|---|
| Followers | 51,240 |
| 28D reach | 312,800 |
| Profile views | 8,940 |
| Accounts engaged | 24,510 |
| Interactions | 41,320 |
| Audience target market | Canada + US ~70% |

Mock posts are seeded with deterministic random (`random.Random(42)`) so the demo is reproducible across deploys. Captions, thumbnails, and metric distributions are designed to exercise every UI state: winner, promising, underperformer, neutral.

---

## 9. Decision Log

Dated decisions with rationale. What was rejected is documented as seriously as what was accepted.

---

**Action Board prompt: iterate freely on language, not on rules**
Prompt language, tone, and examples can be iterated at any time. What requires evidence (n ≥ 5 posts validating the pattern) before changing: scoring weights, format composition rules, new hard constraints in the static block.
Rejected: blanket prompt freeze until a fixed post count. Reason: the domain moves fast (Instagram algorithm, celebrity cycles, seasonal trends). Freeze applies only to codifying new ground truth, not to iteration.

**Action Board stays on Sonnet, not Haiku**
Format strategy (48h window, celebrity recency, retailer anchors, weekly memory) requires reasoning complexity Haiku does not reliably produce.
Rejected: Haiku migration for cost. At 1 user the saving is ~$0.75/month — not worth quality risk.
Reopen when: 50+ users, or `prompt-tester` shows equivalent Haiku output.

**Carousels are an open hypothesis, not an anti-pattern**
Carousels are not on the never-recommend list. Hypothesis: Format D as carousel may work well as a swipeable shopping list. Need 2-3 proper attempts before concluding.
Rejected: blanket "carousels don't work." Reason: insufficient n with proper format execution.

**SlowAPI default_limits removed, pool_recycle added**
Removed global SlowAPI limits — they caused unbounded `MemoryStorage` growth and Railway RAM creep toward OOM. Per-endpoint limits remain.
Added `pool_recycle=1800` to `create_engine` to avoid stale Postgres connections after Railway worker restarts.

**`--limit-max-requests 500` added (overrides earlier rejection — 2026-05-13)**
Previous decision rejected this on the grounds that worker recycles would silently kill APScheduler. Reconsidered for this codebase specifically: this is a **portfolio demo**, not a production tool. The two scheduler jobs are:
- Daily Instagram refresh at 12:00 UTC — missing one day occasionally is acceptable; the data exists to look real to recruiters, not to drive operational decisions.
- Weekly token check on Mondays at 09:00 UTC — only matters every ~60 days when the long-lived token nears expiry, and the failure mode is a logged warning, not data loss.

Worker recycles re-register both jobs in `lifespan`, so the schedule resumes on the next worker. The only risk is the cron firing during the exact window of a recycle, which is rare and acceptable for a demo.

Trade-off accepted: paying ~$0.30/month less in Railway memory beats theoretical 99% scheduler reliability for a service that nobody uses operationally.

This decision does **not** propagate to `yamiyordii-command-center`, where the scheduler drives a real user's content workflow.

**Auto-login on the demo, password screen on production**
The public demo skips the login screen — recruiters open the link and land on the dashboard immediately. The same code in production gates behind HTTP Basic Auth + brute-force protection. Toggle is environment-driven, not a code fork.

---

## 10. Hypothesis Ledger

`VALIDATED` — n ≥ 5, consistent pattern · `HYPOTHESIS` — some signal, insufficient n · `WAITING` — not built yet

**H1 — The 4 formats produce real signal** `HYPOTHESIS`
Designed from production data. Demo cannot validate — it serves mock fixtures.

**H2 — Trial Reels reset audience composition** `HYPOTHESIS`
Logic is sound. Requires before/after distribution data over months.

**H3 — Posting day/time affects performance** `HYPOTHESIS — data unreliable`
Common timezone-conversion pitfalls (UTC vs EST in the database) make day/time analysis fragile. Do not build timing recommendations until the timezone query is verified and n ≥ 10 per slot.

**H4 — Series content decays when the trending window closes** `VALIDATED in production`
Encoded as the 48h rule in the Action Board contract.

**H5 — Carousels work with proper format execution** `HYPOTHESIS — untested`
Need 2-3 proper Format A/B/C/D carousels before concluding.

---

**WAITING ON DATA / FUTURE WORK:**

| Item | Waiting for |
|---|---|
| Pre-publish gate (score idea before filming) | Heuristic-only, ready to build |
| Series Tracker | ≥ 5 distinct series in DB |
| Cold Streak consecutive detector | ≥ 3 documented streaks |
| Headlines tab (trends API) | TikTok Research API access |
| Deals tab | First brand deal |
| Migrate AI Insights to Haiku | 50+ users + prompt-tester equivalence |

---

## 11. Code Rules

- Never `any` in TypeScript
- Parameterized queries — never f-string SQL
- TypeScript types in `/types/index.ts` before writing components
- API calls only in `/services/api.ts` — never directly in components
- Run `/simplify` after every fix or feature before committing
- Read `CLAUDE.md` at session start before touching code
- Conventional commits: `feat:` `fix:` `refactor:` `docs:` `chore:`
- Respond to the user in Spanish. Code and commits in English.

---

## 12. Tech Debt

**`_perf_score` in `routers/instagram.py`** — uses an old formula `(shares×4 + saves×3) × log(reach+1)` instead of `post_weighted_score()`. Cost: UI score and AI score are inconsistent. Fix: 1-line change, no migration.

**`avg_reach` baseline hardcoded** — should be computed from DB on startup so performance labels stay calibrated as the account grows.

**`_week_start_utc()` duplicated** in `insights.py` and `action_board.py`. Cost: divergence risk if one is updated. Fix: move to `utils.py`.

**Post analysis PATCH failure re-triggers Claude** — if `PATCH /api/posts/{id}/ai-analysis` fails, the next modal open calls Claude again (burns one of the 2 lifetime calls per post). Fix: add a pending/failed state to the post model.

**Post ranking not cached by week** — uses Claude Sonnet on every call. Could be cached like AI Insights. Cost: extra tokens per session.

**`HeadlinesTab` and `DealsTab` are built but flag-hidden** — waiting for trends API integration and first brand deal respectively. Code is dead weight until then.

**Auth credentials in `sessionStorage` (12h TTL)** — acceptable for a public demo, would be replaced by a more robust session strategy in any multi-user deployment.

---

## 13. Development Environment — Claude Code

This project was built using **Claude Code** as the primary development environment.

### Custom Skills (Slash Commands)
Stored in `.claude/commands/`:

| Skill | What it does |
|---|---|
| `/deploy` | Pre-flight git checks, then `railway up` + `vercel deploy --prod` in correct order |
| `/new-feature` | Checks git state, suggests a conventional-commit branch name, creates and switches to it |
| `/reset-rate-limit` | Shifts this week's AI generation timestamps back 8 days so the weekly counter resets without deleting cached content |

### Prompt Tester Sub-Agent
A custom sub-agent for safely iterating on Claude prompts:
- Pulls real post data from the production database (when run there)
- Runs the **current prompt (baseline)** and **modified prompt** against the same dataset
- Produces a structured comparison: metrics diff, quality assessment, `SHIP IT / NEEDS WORK / REVERT` recommendation
- Never modifies source files or burns a weekly rate-limit token

This made it safe to iterate on Action Board and AI Insights prompts across multiple versions without risking the production weekly generation budget.
