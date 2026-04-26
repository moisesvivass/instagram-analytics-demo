#!/bin/bash
# Blocks git commit if staged changes contain secrets.
# Triggered via PreToolUse on Bash(git commit*) — matcher guarantees this is a commit.

added=$(git diff --cached --unified=0 2>/dev/null | grep "^+" | grep -v "^+++")

[ -z "$added" ] && exit 0

FOUND=0

check() {
  local label="$1"
  local pattern="$2"
  if echo "$added" | grep -qE "$pattern"; then
    echo "  [!] $label" >&2
    FOUND=1
  fi
}

check "Anthropic API key (sk-ant-...)"    "sk-ant-[A-Za-z0-9_-]{20,}"
check "Instagram access token (EAA...)"   "EAA[A-Za-z0-9]{30,}"
check "DATABASE_URL with credentials"     "DATABASE_URL\s*=\s*postgresql[^$\n]*:[^@\n]+@"
check "ANTHROPIC_API_KEY assignment"      "ANTHROPIC_API_KEY\s*=\s*sk-"
check "INSTAGRAM_ACCESS_TOKEN assignment" "INSTAGRAM_ACCESS_TOKEN\s*=\s*[A-Za-z0-9]{20,}"
check "BASIC_AUTH_PASSWORD assignment"    "BASIC_AUTH_PASSWORD\s*=\s*\S{4,}"
check "Bearer token"                      "Bearer\s+[A-Za-z0-9._-]{20,}"

if [ $FOUND -eq 1 ]; then
  echo "" >&2
  echo "BLOCKED: Secret(s) detected in staged changes." >&2
  echo "Run 'git diff --cached' to review. Remove secrets before committing." >&2
  exit 2
fi

exit 0
