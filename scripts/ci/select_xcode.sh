# scripts/ci/select_xcode.sh
#!/usr/bin/env bash
set -euo pipefail

# Prefer Xcode 16.x on macos-15 runners when present, else fallback.
if [ -d "/Applications/Xcode_16.1.app" ]; then
  sudo xcode-select -s "/Applications/Xcode_16.1.app/Contents/Developer"
elif [ -d "/Applications/Xcode_16.0.app" ]; then
  sudo xcode-select -s "/Applications/Xcode_16.0.app/Contents/Developer"
elif [ -d "/Applications/Xcode_15.4.app" ]; then
  sudo xcode-select -s "/Applications/Xcode_15.4.app/Contents/Developer"
else
  echo "::warning::No preferred Xcode found; using default."
fi

xcodebuild -version
