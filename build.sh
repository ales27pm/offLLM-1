#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
XCODE_ENV_HELPER="$ROOT_DIR/scripts/lib/xcode_env.sh"
NPM_ENV_HELPER="$ROOT_DIR/scripts/lib/npm_env.sh"
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

# shellcheck source=scripts/lib/npm_env.sh
source "$NPM_ENV_HELPER"
# Normalize deprecated npm proxy environment variables before invoking npm.
sanitize_npm_proxy_env

# shellcheck source=scripts/lib/xcode_env.sh
source "$XCODE_ENV_HELPER"
sanitize_xcode_env

# Configuration
# Default to the monGARS scheme
: "${SCHEME:=monGARS}"
# Resolve the iOS project path to an absolute location to avoid
# issues when the caller provides IOS_PROJECT_DIR as a relative path.
IOS_PROJECT_DIR=$(cd "${IOS_PROJECT_DIR:-${PWD}/ios}" && pwd)
: "${WORKSPACE:=${IOS_PROJECT_DIR}/monGARS.xcworkspace}"
: "${BUILD_DIR:=build}"
: "${REQUIRED_NODE_VERSION:=20.0.0}"

echo "▶️ Starting robust unsigned iOS build..."

# Step 1: Validate Node.js version
CURRENT_NODE_VERSION=$(node -v | sed 's/v//')
version_ge() {
  [[ "$1" == "$2" ]] && return 0
  [[ "$1" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 2
  local v1_major=${BASH_REMATCH[1]} v1_minor=${BASH_REMATCH[2]} v1_patch=${BASH_REMATCH[3]}
  [[ "$2" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 2
  local v2_major=${BASH_REMATCH[1]} v2_minor=${BASH_REMATCH[2]} v2_patch=${BASH_REMATCH[3]}
  [[ $v1_major -gt $v2_major ]] && return 0 || [[ $v1_major -lt $v2_major ]] && return 1
  [[ $v1_minor -gt $v2_minor ]] && return 0 || [[ $v1_minor -lt $v2_minor ]] && return 1
  [[ $v1_patch -ge $v2_patch ]]
}
if ! version_ge "$CURRENT_NODE_VERSION" "$REQUIRED_NODE_VERSION"; then
  echo "❌ Error: Node.js $REQUIRED_NODE_VERSION or higher is required. Current version is $CURRENT_NODE_VERSION."
  exit 1
fi
echo "✅ Node.js version $CURRENT_NODE_VERSION is compatible."

# Step 2: Clean all caches and dependencies
echo "🧹 Cleaning all dependencies and caches..."
rm -rf node_modules
rm -rf "$BUILD_DIR" "${IOS_PROJECT_DIR}/build"
mkdir -p "$BUILD_DIR"

# Step 3: Reinstall dependencies
echo "📦 Installing Node.js dependencies..."
npm ci

echo "📦 Installing Ruby dependencies for CocoaPods..."
(cd "$IOS_PROJECT_DIR" && bundle install)

echo "📱 Generating Xcode project and installing CocoaPods..."
(cd "$IOS_PROJECT_DIR" && \
  xcodegen generate && \
  bundle exec pod update hermes-engine --no-repo-update && \
  bundle exec pod install --repo-update)

# Ensure the Xcode workspace exists before attempting to build. If it's
# missing, retry CocoaPods install once and exit if it still doesn't appear.
ensure_workspace() {
  if [ ! -e "$WORKSPACE" ]; then
    echo "⚠️ Workspace not found at $WORKSPACE; rerunning CocoaPods install..."
    (cd "$IOS_PROJECT_DIR" && \
      bundle exec pod update hermes-engine --no-repo-update && \
      bundle exec pod install --repo-update)
  fi

  if [ ! -e "$WORKSPACE" ]; then
    echo "❌ Error: Xcode workspace still missing at $WORKSPACE"
    return 1
  fi
}

ensure_workspace

# Step 3.5: Clear module caches without nuking the entire DerivedData tree
echo "🧽 Clearing Xcode module caches..."
rm -rf ~/Library/Developer/Xcode/DerivedData/ModuleCache.noindex
rm -rf ~/Library/Developer/Xcode/DerivedData/ModuleCache

# Force a clean build without deleting caches wholesale
XCODEBUILD_EXTRA_FLAGS=(
  -IDEBuildOperationRebuildFromScratch=YES
)

# Step 4: Run the Xcode build (Simulator, unsigned)
echo "📦 Building for iOS Simulator (unsigned)..."
xcodebuild "${XCODEBUILD_EXTRA_FLAGS[@]}" build \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  -resultBundlePath "$BUILD_DIR/${SCHEME}.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  | tee "$BUILD_DIR/xcodebuild.log"

echo "📦 Packaging simulator build as artifact..."
APP_DIR="$BUILD_DIR/DerivedData/Build/Products/Release-iphonesimulator"
APP_PATH="$(/usr/bin/find "$APP_DIR" -maxdepth 1 -name "${SCHEME}.app" -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "❌ Error: Built .app not found in $APP_DIR"
  exit 1
fi
PAYLOAD_DIR="$BUILD_DIR/Payload"
rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR"
cp -R "$APP_PATH" "$PAYLOAD_DIR/"
(cd "$BUILD_DIR" && zip -qr monGARS-unsigned-ipa.zip Payload)
echo "✅ Artifact created at $BUILD_DIR/monGARS-unsigned-ipa.zip"

echo "✅ Build script completed."



