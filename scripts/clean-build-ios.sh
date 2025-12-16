#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NPM_ENV_HELPER="$ROOT_DIR/scripts/lib/npm_env.sh"
# shellcheck source=lib/npm_env.sh
if [ -f "$NPM_ENV_HELPER" ]; then
  source "$NPM_ENV_HELPER"
else
  echo "❌ Missing helper: $NPM_ENV_HELPER" >&2
  exit 1
fi
# Normalize deprecated npm proxy environment variables before invoking npm.
sanitize_npm_proxy_env --include-lowercase

echo "Starting clean iOS build process..."

# Step 1: Clean JavaScript dependencies
rm -rf node_modules package-lock.json

# Step 2: Clean iOS native dependencies and build artifacts
pushd ios >/dev/null
rm -rf Pods Podfile.lock build
popd >/dev/null

# Step 3: Reinstall all dependencies
npm ci
pushd ios >/dev/null
bundle install
xcodegen generate
bundle exec pod update hermes-engine --no-repo-update
bundle exec pod install --repo-update
popd >/dev/null

# Step 4: Reset the React Native bundler cache
npx react-native start --reset-cache >/dev/null 2>&1 &
BUNDLER_PID=$!
trap 'kill "$BUNDLER_PID" 2>/dev/null || true' EXIT INT TERM
# Wait up to 30s for Metro on 8081
for i in {1..30}; do
  if command -v nc >/dev/null 2>&1; then
    if nc -z localhost 8081 2>/dev/null; then
      break
    fi
  elif command -v curl >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 1
done

# Step 5: Build the iOS application
npx react-native build-ios --mode Release

# Step 6: Kill the bundler process
kill "$BUNDLER_PID" 2>/dev/null || true

echo "✅ Clean iOS build process completed successfully."



