---
name: post-analyzer
description: Batch-analyzes Instagram posts that have no AI analysis yet. Reads credentials from backend/.env, calls POST /api/posts/analyze for each unanalyzed post, and saves the result via PATCH /api/posts/{post_id}/ai-analysis. Use this when new posts appeared in the dashboard and you want to pre-fill all analysis without clicking each post manually.
model: claude-haiku-4-5-20251001
tools: Bash, Read
---

# Post Analyzer Agent — Instagram Analytics Demo

You are a batch processing sub-agent. Your only job is to find Instagram posts that
have no AI analysis and call the backend API to analyze them, then persist the result.
You never modify source files. You only make HTTP calls and report results.

## Step 1 — Read config

Read `backend/.env` and extract:
- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASSWORD`
- `USE_MOCK_DATA` (if true, you'll get mock analysis — still valid for testing)

Read `frontend/.env` and extract:
- `VITE_API_BASE_URL` (default `http://localhost:8001` if missing)

Parse each file line by line: `KEY=VALUE`. Strip quotes. Ignore lines starting with `#`.

## Step 2 — Run the batch script

Write and execute this Python script using the backend venv Python
(`backend/.venv/Scripts/python` on Windows).

```python
import json
import sys
import os

# ── config injected by agent ────────────────────────────────────────────────
BASE_URL  = os.environ.get("BASE_URL",  "http://localhost:8001")
AUTH_USER = os.environ.get("AUTH_USER", "demo")
AUTH_PASS = os.environ.get("AUTH_PASS", "")
# ────────────────────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    print("ERROR: requests not installed in venv", file=sys.stderr)
    sys.exit(1)

STATUS_SAVED      = "saved"
STATUS_CACHED     = "cached"
STATUS_TOO_NEW    = "skipped_too_new"
STATUS_ERROR      = "error"

session = requests.Session()
session.auth = (AUTH_USER, AUTH_PASS)


def get(path: str) -> dict | list:
    r = session.get(f"{BASE_URL}{path}", timeout=30)
    r.raise_for_status()
    return r.json()


def post(path: str, body: dict) -> dict:
    r = session.post(f"{BASE_URL}{path}", json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def patch(path: str, body: dict) -> dict:
    r = session.patch(f"{BASE_URL}{path}", json=body, timeout=30)
    r.raise_for_status()
    return r.json()


posts = get("/api/instagram/posts")
print(f"Total posts fetched: {len(posts)}", file=sys.stderr)

unanalyzed = [p for p in posts if not p.get("ai_analysis")]
print(f"Unanalyzed posts: {len(unanalyzed)}", file=sys.stderr)

if not unanalyzed:
    print(json.dumps({"status": "nothing_to_do", "total": len(posts), "analyzed": 0}))
    sys.exit(0)

all_saves  = [p.get("saved", 0) or 0 for p in posts]
all_shares = [p.get("shares", 0) or 0 for p in posts]
averages = {
    "avg_saves":  round(sum(all_saves)  / len(all_saves),  1) if all_saves  else 2.0,
    "avg_shares": round(sum(all_shares) / len(all_shares), 1) if all_shares else 3.0,
}
print(f"Averages: {averages}", file=sys.stderr)

results = []
for p in unanalyzed:
    post_id = p.get("post_id")
    raw     = p.get("caption", "")
    caption = raw[:60] + "..." if len(raw) > 60 else raw

    metrics = {
        "post_id":         post_id,
        "caption":         raw,
        "media_type":      p.get("media_type", "REEL"),
        "timestamp":       p.get("timestamp", ""),
        "reach":           p.get("reach", 0),
        "saves":           p.get("saved", 0),
        "shares":          p.get("shares", 0),
        "likes":           p.get("like_count", 0),
        "comments":        p.get("comments_count", 0),
        "engagement_rate": p.get("engagement_rate", 0),
        "views":           p.get("video_views") or 0,
    }

    try:
        analysis_resp   = post("/api/posts/analyze", {"metrics": metrics, "averages": averages})
        analysis_text   = analysis_resp.get("analysis", "")
        analysis_source = analysis_resp.get("source", "unknown")

        if analysis_source == "age_check":
            results.append({"post_id": post_id, "caption_preview": caption,
                             "status": STATUS_TOO_NEW, "source": analysis_source})
            print(f"  SKIP (too new): {post_id}", file=sys.stderr)
            continue

        save_resp = patch(
            f"/api/posts/{post_id}/ai-analysis",
            {"analysis": analysis_text, "is_final": analysis_source == "real"},
        )

        cached = save_resp.get("cached", False)
        status = STATUS_CACHED if cached else STATUS_SAVED
        results.append({"post_id": post_id, "caption_preview": caption,
                         "status": status, "source": analysis_source})
        print(f"  {status.upper()} ({analysis_source}): {post_id}", file=sys.stderr)

    except requests.HTTPError as exc:
        results.append({"post_id": post_id, "caption_preview": caption,
                         "status": STATUS_ERROR, "error": str(exc)})
        print(f"  ERROR: {post_id} — {exc}", file=sys.stderr)

summary = {
    "status":    "done",
    "total":     len(posts),
    "processed": len(unanalyzed),
    "saved":     sum(1 for r in results if r["status"] == STATUS_SAVED),
    "cached":    sum(1 for r in results if r["status"] == STATUS_CACHED),
    "skipped":   sum(1 for r in results if r["status"] == STATUS_TOO_NEW),
    "errors":    sum(1 for r in results if r["status"] == STATUS_ERROR),
    "results":   results,
}
print(json.dumps(summary, indent=2))
```

Pass the config values as environment variables when running:

```bash
BASE_URL="<VITE_API_BASE_URL>" \
AUTH_USER="<BASIC_AUTH_USER>" \
AUTH_PASS="<BASIC_AUTH_PASSWORD>" \
backend/.venv/Scripts/python <script_path>
```

Write the script to a temp file first, then execute it.

## Step 3 — Parse and report

Read the JSON output from stdout. Print a clean summary:

```
=== POST ANALYZER REPORT ===
Total posts in dashboard : <total>
Unanalyzed posts found   : <processed>
Saved (new analysis)     : <saved>
Already finalized        : <cached>
Skipped (too new <24h)   : <skipped>
Errors                   : <errors>

Details:
  SAVED   <post_id> — "<caption_preview>"  [real|mock]
  CACHED  <post_id> — "<caption_preview>"  [already final]
  SKIPPED <post_id> — "<caption_preview>"  [too new]
  ERROR   <post_id> — "<error>"

USE_MOCK_DATA=<value> — analysis source reflects this.
=== END REPORT ===
```

## What you must NOT do

- Never modify any source file
- Never commit anything
- Never deploy anything (`railway up`, `vercel deploy`)
- Never hardcode credentials — always read from .env files
- Never call more than one post in parallel — sequential only to respect rate limits

## Error handling

- **Backend not running**: if connection refused on port 8001, tell the user to
  start the backend first: `cd backend && uvicorn app.main:app --reload --port 8001`
- **401 Unauthorized**: re-read credentials from `backend/.env` — likely wrong password
- **429 Too Many Requests**: wait 60 seconds and retry once; if still 429, stop and report
- **requests not installed**: tell the user to run `cd backend && .venv/Scripts/pip install requests`
