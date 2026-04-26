---
name: deploy
description: Use this skill when the user asks to deploy, ship, push to production, or publish changes to Railway or Vercel. Also trigger on Spanish equivalents like "deploya", "deployalo", "subelo a produccion", "manda a prod". Do NOT trigger for general git operations (push, commit, merge) unless the user explicitly mentions deploying.
---

# Deploy — Instagram Analytics Demo

Deploy rules for this project are non-negotiable:
- **Backend** deploys via `railway up` from `/backend`
- **Frontend** deploys via `vercel deploy --prod` from `/frontend`
- **Never via GitHub.** No git push to remote, no CI/CD.

---

## Step 1 — Git checks (run in parallel)

```bash
git status
git branch --show-current
```

**If uncommitted changes exist:**
Stop. Tell the user what files are dirty and ask: commit first, stash, or abort.
Never deploy with a dirty working tree.

**If not on main:**
Warn the user. Ask for explicit confirmation to proceed.
If the user does not confirm — stop.

---

## Step 2 — Pre-deploy validation

Run validation only for the target (backend, frontend, or both).
Stop and report the error if any check fails — do not proceed to deploy.

When deploying **both**, run backend and frontend validation in parallel.

### Backend validation
```bash
cd backend && .venv/Scripts/python -m compileall app/ -q
```
Recursively checks all Python files in `app/`. If any file has a syntax error,
it prints the offending file and exits non-zero.

### Frontend validation
```bash
cd frontend && npm run build 2>&1
```
Runs `tsc && vite build` — catches TypeScript errors before Vercel sees them.

---

## Step 3 — Ask what to deploy

Ask the user:
- `backend` only
- `frontend` only
- `both`

Default to asking — never assume.

---

## Step 4 — Execute

### Backend
```bash
cd backend && railway up
```
Streams output. Typically 60-120s. Watch for `Deployment complete` or error lines.

### Frontend
```bash
cd frontend && vercel deploy --prod
```
Streams output. Typically 30-60s. Capture the production URL from the output.

### Both
Run sequentially — backend first so the frontend picks up any new API changes.
Do NOT parallelize.

---

## Step 5 — Post-deploy health check

After backend deploys, verify it came up. Get the Railway URL from CLAUDE.md or the Railway dashboard.

```bash
curl -s -o /dev/null -w "%{http_code}" https://demo:<PASSWORD>@<RAILWAY_URL>/api/health
```

Replace `<PASSWORD>` with `BASIC_AUTH_PASSWORD` from `backend/.env`.
Replace `<RAILWAY_URL>` with the Railway backend URL from CLAUDE.md.

- **200** — backend is healthy. Report success.
- **401/403** — deployed but auth issue — check env vars on Railway.
- **502/503/timeout** — deploy may still be starting — wait 15s, then retry once.
- **Still failing after retry** — tell the user to check Railway logs: `cd backend && railway logs`

For frontend: confirm the Vercel production URL from the CLI output loads correctly.

---

## Post-deploy report

Tell the user:
- What was deployed (backend, frontend, or both)
- The live URL(s)
- Any warnings from the CLI output

---

## What NOT to do

- Never deploy from a directory other than `/backend` or `/frontend`
- Never skip pre-deploy validation
- Never deploy with uncommitted changes without explicit user approval
