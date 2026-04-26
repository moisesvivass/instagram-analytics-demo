---
name: new-feature
description: Use this skill at the START of a session or task when the user wants to build something new, fix a bug, or make any code change that doesn't already have an active branch. Trigger on phrases like "vamos a hacer", "quiero hacer", "hagamos", "nueva feature", "empecemos con", "build", "add", "implement", or any request to start coding something. Also trigger if the user is about to touch code and git status shows they are on master with no active feature branch for this work. Do NOT trigger if a feature branch is already active (i.e. current branch is not master).
---

# New Feature — Branch Setup

Every code change in this project lives on its own branch. Never work directly on master.

## Step 1: Check current state

Run in parallel:
- `git branch --show-current` — what branch are we on?
- `git status` — any uncommitted work?

## Step 2: Decision

**If already on a feature branch (not master):**
Skip this skill entirely. Tell the user we're already on branch X and ask if they want to continue here or create a new one.

**If on master and clean:**
Proceed to Step 3.

**If on master with uncommitted changes:**
Stop and resolve first. Ask the user: commit, stash, or abort?

## Step 3: Name the branch

Branch naming follows conventional commit format:
```
type/short-description
```

Types:
- `feat/` — new feature or enhancement
- `fix/` — bug fix
- `refactor/` — restructuring without behavior change
- `chore/` — docs, config, tooling
- `hotfix/` — urgent production fix

Rules:
- All lowercase, no spaces, hyphens only
- Short but descriptive: `feat/cold-streak-detector`, not `feat/new-widget`
- Max 4 words after the slash

**Suggest a branch name based on what the user described.** Ask for confirmation before creating.

Example:
> User: "quiero hacer el cold streak detector"
> You: "Branch name: `feat/cold-streak-detector` — ¿va?"

## Step 4: Create and switch

```bash
git checkout -b <branch-name>
```

Confirm with `git branch --show-current` after.

## Step 5: Tell the user we're ready

One line: "Estamos en `feat/cold-streak-detector`. Let's build."

Then proceed with the actual work.

---

## End of session — merge reminder

When the feature is done, tested, and deployed, remind the user to merge back to master:

```bash
git checkout master
git merge <branch-name> --no-ff
```

Don't do it automatically — ask first.
