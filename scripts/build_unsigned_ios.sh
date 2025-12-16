#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
XCODE_ENV_HELPER="$ROOT_DIR/scripts/lib/xcode_env.sh"
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

# shellcheck source=lib/xcode_env.sh
source "$XCODE_ENV_HELPER"
sanitize_xcode_env

# Simple unsigned iOS Simulator build helper. Assumes pods and project are ready.

ROOT="$(pwd)"
IOS_DIR="ios"
BUILD_DIR="${BUILD_DIR:-build}"
DERIVED_DATA="${DERIVED_DATA:-${BUILD_DIR}/derived-data}"

: "${SCHEME:?SCHEME env var required}"
: "${WORKSPACE:?WORKSPACE env var required}"
IOS_DESTINATION="${IOS_DESTINATION:-}"

RESULT_BUNDLE="${RESULT_BUNDLE:-${BUILD_DIR}/${SCHEME}.xcresult}"
LOG_FILE="${LOG_FILE:-${BUILD_DIR}/xcodebuild.log}"

# Ensure output directories exist (supports custom paths)
mkdir -p "$BUILD_DIR"
mkdir -p "$(dirname "$RESULT_BUNDLE")"
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$DERIVED_DATA"

echo "▶️  Unsigned iOS build starting…"
echo "Environment:"
echo "  SCHEME=${SCHEME}"
echo "  WORKSPACE=${WORKSPACE}"
if [ -n "${IOS_DESTINATION}" ]; then
  echo "  IOS_DESTINATION=${IOS_DESTINATION}"
fi
if [ -n "${IOS_SIM_OS:-}" ]; then
  echo "  IOS_SIM_OS=${IOS_SIM_OS}"
fi
echo

XCODE_CMD=(xcodebuild
  -workspace "$WORKSPACE"
  -scheme "$SCHEME"
  -configuration Release
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  CODE_SIGN_ENTITLEMENTS=
  CODE_SIGN_STYLE=Manual
  -derivedDataPath "$DERIVED_DATA"
  -resultBundlePath "$RESULT_BUNDLE"
)
if [ -n "${IOS_DESTINATION}" ]; then
  XCODE_CMD+=(-destination "${IOS_DESTINATION}")
fi
"${XCODE_CMD[@]}" | tee "$LOG_FILE"

APP_PATH="${DERIVED_DATA}/Build/Products/Release-iphonesimulator/${SCHEME}.app"
if [ ! -d "${APP_PATH}" ]; then
  echo "error: expected app bundle at ${APP_PATH}" >&2
  exit 1
fi
ditto -ck --sequesterRsrc --keepParent "$APP_PATH" "${IOS_DIR}/${SCHEME}-Simulator.zip"

echo "✅  Simulator build finished."



