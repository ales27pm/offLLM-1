#!/usr/bin/env bash
# Ensure the selected Xcode has an iPhoneOS device SDK available.
# If not, attempt to download/install the iOS platform (when supported).
set -euo pipefail

log() { printf '[ensure_ios_platform] %s\n' "$1"; }

log "Active Xcode:"
xcodebuild -version || true

log "SDKs before:"
xcodebuild -showsdks || true

if xcrun --sdk iphoneos --show-sdk-version >/dev/null 2>&1; then
  log "✅ iphoneos SDK present: $(xcrun --sdk iphoneos --show-sdk-version)"
  exit 0
fi

log "⚠️ iphoneos SDK missing. Attempting Xcode first-launch + platform download…"

# RunFirstLaunch fixes a surprising number of 'platform not installed' states.
sudo xcodebuild -runFirstLaunch || true

# Try platform download (may fail if the runner image doesn't support it).
sudo xcodebuild -downloadPlatform iOS || true

log "SDKs after download attempt:"
xcodebuild -showsdks || true

if ! xcrun --sdk iphoneos --show-sdk-version >/dev/null 2>&1; then
  echo "::error::iphoneos SDK still missing after download attempt. Pick a different Xcode (or runner image) that includes the iOS device platform."
  exit 1
fi

log "✅ iphoneos SDK now present: $(xcrun --sdk iphoneos --show-sdk-version)"
