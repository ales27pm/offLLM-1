#!/usr/bin/env bash
set -euo pipefail
ARCHIVE_PATH="${1:-build/DerivedData/Archive.xcarchive}"
OUT_DIR="${2:-build}"
APP_NAME_HINT="${3:-}"
if [ ! -d "$ARCHIVE_PATH" ]; then
  echo "::error title=Archive not found::'$ARCHIVE_PATH' does not exist (archive failed)."
  exit 66
fi
APP_DIR="${ARCHIVE_PATH}/Products/Applications"
if [ ! -d "$APP_DIR" ]; then
  echo "::error title=No Applications inside archive::'$APP_DIR' missing (compile/signing probably failed)."
  exit 67
fi
if [ -n "$APP_NAME_HINT" ] && [ -d "$APP_DIR/$APP_NAME_HINT.app" ]; then
  APP_PATH="$APP_DIR/$APP_NAME_HINT.app"
else
  APP_COUNT=$(/usr/bin/find "$APP_DIR" -maxdepth 1 -name '*.app' | wc -l)
  if [ "$APP_COUNT" -eq 0 ]; then
    echo "::error title=No .app bundles found::No .app bundles found in '$APP_DIR'."
    exit 68
  elif [ "$APP_COUNT" -gt 1 ]; then
    echo "::error title=Multiple .app bundles found::Multiple .app bundles found in '$APP_DIR' and APP_NAME_HINT is unset. Please specify APP_NAME_HINT to select the correct app."
    /usr/bin/find "$APP_DIR" -maxdepth 1 -name '*.app'
    exit 69
  else
    APP_PATH="$(/usr/bin/find "$APP_DIR" -maxdepth 1 -name '*.app' -print -quit)"
  fi
fi
if [ -z "${APP_PATH:-}" ] || [ ! -d "$APP_PATH" ]; then
  ls -la "$APP_DIR" || true
  echo "::error title=.app not found in archive::No .app under $APP_DIR."
  exit 68
fi
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
APP_BASENAME="$(basename "$APP_PATH" .app)"
( cd "$(dirname "$APP_PATH")" && /usr/bin/zip -qry "${OUT_DIR}/${APP_BASENAME}.zip" "$(basename "$APP_PATH")" )
TMP="$(mktemp -d)"; mkdir -p "$TMP/Payload"
cp -R "$APP_PATH" "$TMP/Payload/"
( cd "$TMP" && /usr/bin/zip -qry "${OUT_DIR}/${APP_BASENAME}.ipa" "Payload" )
rm -rf "$TMP"
echo "::notice title=Packaging complete::${OUT_DIR}/${APP_BASENAME}.ipa"




