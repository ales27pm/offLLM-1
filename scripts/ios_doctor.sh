#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.default"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [ -f "$DEFAULT_ENV_FILE" ]; then
  echo "ℹ️ No .env file found; loading defaults from $DEFAULT_ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$DEFAULT_ENV_FILE"
  set +a
fi

DERIVED_DATA_DIR="${DERIVED_DATA:-$HOME/Library/Developer/Xcode/DerivedData}"
MODULE_CACHE_DIR="${MODULE_CACHE_DIR:-$DERIVED_DATA_DIR/ModuleCache.noindex}"
rm -rf "$DERIVED_DATA_DIR"
rm -rf "$MODULE_CACHE_DIR"

IOS_DIR="${1:-"$ROOT_DIR/ios"}"
WS=""
for ws in "$IOS_DIR"/*.xcworkspace; do
  if [ -e "$ws" ]; then
    WS="$ws"
    break
  fi
done
if [ -z "${WS:-}" ]; then
  echo "❌ No .xcworkspace found after 'pod install' in: $IOS_DIR"
  exit 1
fi
echo "✅ Found workspace: $WS"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "WORKSPACE=$WS" >> "$GITHUB_ENV"
fi



