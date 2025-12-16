#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
XCODE_ENV_HELPER="$REPO_ROOT/scripts/lib/xcode_env.sh"
# shellcheck source=../../scripts/lib/xcode_env.sh
source "$XCODE_ENV_HELPER"
sanitize_xcode_env

WS="${WORKSPACE:-monGARS.xcworkspace}"
SCHEME="${SCHEME:-monGARS}"

if [ ! -f "$WS/contents.xcworkspacedata" ]; then
  echo "::error title=Missing Xcode workspace::ios/$WS not found post-install. Did 'bundle exec pod install' run?"
  exit 2
fi

if [ ! -f "Pods/Pods.xcodeproj/project.pbxproj" ]; then
  echo "::error title=Missing Pods project::ios/Pods/Pods.xcodeproj not found. Did 'bundle exec pod install' succeed?"
  exit 3
fi

if ! xcodebuild -list -json -workspace "$WS" | python - "$SCHEME" <<'PY'
import json,sys
scheme = sys.argv[1]
j = json.load(sys.stdin)
print(1 if scheme in j.get('workspace', {}).get('schemes', []) else 0)
PY
then
  echo "::error title=Missing scheme::Scheme '$SCHEME' not found in workspace."
  exit 4
fi
echo "OK: workspace, Pods project, and scheme present."



