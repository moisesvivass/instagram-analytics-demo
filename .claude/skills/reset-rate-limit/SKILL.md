---
name: reset-rate-limit
description: Use this skill when the user says the AI Insights or Action Board hit the weekly limit, can't regenerate, is getting a 429 error, or says something like "ya hicimos el 3 de 3", "llegamos al limite", "no puedo regenerar", "reset the limit", "reset the counter". Only applies to the instagram-analytics-demo project.
---

# Reset Weekly Rate Limit — Instagram Analytics Demo

The weekly limit is 3 generations per feature, tracked by counting rows where:
- `source = 'real'`
- `generated_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC')` (Monday 00:00 UTC)

Tables affected:
- `ai_insights` — AI Insights tab
- `action_board_cache` — Action Board tab

## How the reset works

Push this week's `real` rows back 8 days so they fall outside the weekly window. The count reads 0 and the user can regenerate.

## Step 1: Get the Railway public DB URL

```bash
cd backend && railway variables --service Postgres --json
```

Extract `DATABASE_PUBLIC_URL` — format:
```
postgresql://postgres:<password>@tramway.proxy.rlwy.net:<port>/railway
```

## Step 2: Ask the user what to reset

Options:
- `ai_insights` only
- `action_board_cache` only
- `both` (default — most common case)

## Step 3: Run the SQL

```bash
psql "<DATABASE_PUBLIC_URL>" -c "
UPDATE ai_insights
SET generated_at = generated_at - INTERVAL '8 days'
WHERE source = 'real'
AND generated_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC');

UPDATE action_board_cache
SET generated_at = generated_at - INTERVAL '8 days'
WHERE source = 'real'
AND generated_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC');

SELECT 'ai_insights' AS tbl, COUNT(*) AS remaining_this_week
FROM ai_insights
WHERE source = 'real'
AND generated_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC')
UNION ALL
SELECT 'action_board_cache', COUNT(*)
FROM action_board_cache
WHERE source = 'real'
AND generated_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC');
"
```

## Step 4: Verify

The SELECT at the end should return `0` for both tables.

If both show `0`: tell the user they can go regenerate from the dashboard now.
If any shows > 0: something went wrong, show the raw output and investigate.

## Important notes

- This does NOT delete data — it just shifts timestamps back. All generated content is preserved.
- The Railway internal URL (`postgres.railway.internal`) won't work from local. Always use `DATABASE_PUBLIC_URL`.
- `psql` must be installed locally. If not found, tell the user to install PostgreSQL client tools.
- Never hardcode the password — always pull it fresh from `railway variables`.
