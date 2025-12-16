#!/usr/bin/env bash
# Copies the latest ci-reports/<timestamp>/REPORT.md + report_agent.md to repo root
# and commits them. Optionally archives the whole report folder under docs/ci-reports/.
#
# Usage:
#   bash scripts/dev/commit-reports.sh
#   REPORT_TS=20250101-120000 bash scripts/dev/commit-reports.sh   # pick specific timestamp
#   ARCHIVE=1 bash scripts/dev/commit-reports.sh                    # also copy full dir to docs/ci-reports/<ts>
#   MESSAGE="docs(ci): update reports" bash scripts/dev/commit-reports.sh
#
# Env:
#   REPORT_TS  : timestamp folder name under ci-reports/ to use (default = most recent)
#   ARCHIVE    : "1" to also archive the entire report dir under docs/ci-reports/<ts> (default 0)
#   MESSAGE    : git commit message (default provided below)
#   ALLOW_DIRTY: "1" to bypass working-tree clean check (default 0)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# Basics
REPORT_ROOT="ci-reports"
[ -d "$REPORT_ROOT" ] || { echo "❌ No $REPORT_ROOT directory found. Run scripts/dev/doctor.sh first."; exit 1; }

# Pick which report timestamp to use
if [[ -n "${REPORT_TS:-}" ]]; then
  REPORT_DIR="$REPORT_ROOT/$REPORT_TS"
  [ -d "$REPORT_DIR" ] || { echo "❌ $REPORT_DIR does not exist."; exit 1; }
else
  # newest directory inside ci-reports/
  REPORT_DIR="$(ls -1dt "$REPORT_ROOT"/*/ 2>/dev/null | head -n1 || true)"
  [[ -n "$REPORT_DIR" ]] || { echo "❌ No subdirectories in $REPORT_ROOT. Did the doctor run finish?"; exit 1; }
  REPORT_DIR="${REPORT_DIR%/}"
  REPORT_TS="$(basename "$REPORT_DIR")"
fi

REPORT_MD="$REPORT_DIR/REPORT.md"
AGENT_MD="$REPORT_DIR/report_agent.md"

[[ -f "$REPORT_MD" ]] || { echo "❌ Missing $REPORT_MD"; exit 1; }
[[ -f "$AGENT_MD" ]] || { echo "❌ Missing $AGENT_MD"; exit 1; }

# Guard against committing a messy worktree unless overridden
if [[ "${ALLOW_DIRTY:-0}" != "1" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Working tree not clean. Commit/stash your changes or set ALLOW_DIRTY=1."
    exit 1
  fi
fi

# Copy to repo root (canonical names)
cp -f "$REPORT_MD" CI-REPORT.md
cp -f "$AGENT_MD" report_agent.md

# Optional archive of the full folder under docs/ci-reports/<ts>
if [[ "${ARCHIVE:-0}" == "1" ]]; then
  DEST_DIR="docs/ci-reports/$REPORT_TS"
  mkdir -p "$(dirname "$DEST_DIR")"
  # rsync to preserve structure but avoid copying giant xcresult bundle content; link it instead
  rsync -a --delete --exclude '*.xcresult' "$REPORT_DIR/" "$DEST_DIR/"
  # Create a lightweight pointer to the xcresult if present
  if [[ -d "$REPORT_DIR/monGARS.xcresult" ]]; then
    echo "(xcresult present in build dir; not copied here to keep repo light)" > "$DEST_DIR/NOTE_xcresult.txt"
  fi
fi

git add CI-REPORT.md report_agent.md
[[ "${ARCHIVE:-0}" == "1" ]] && git add "docs/ci-reports/$REPORT_TS" || true

COMMIT_MSG="${MESSAGE:-docs(ci): publish CI REPORT.md and report_agent.md ($REPORT_TS)}"
git commit -m "$COMMIT_MSG"

echo "✅ Committed:"
echo "  - CI-REPORT.md"
echo "  - report_agent.md"
[[ "${ARCHIVE:-0}" == "1" ]] && echo "  - docs/ci-reports/$REPORT_TS/**" || true



