#!/usr/bin/env bash
set -euo pipefail

IPA_PATH="${1:?IPA path required}"
KEY_ID="${2:?ASC Key ID required}"
ISSUER_ID="${3:?ASC Issuer ID required}"
KEY_CONTENT_BASE64="${4:?ASC Private Key (base64) required}"

if [[ ! -f "$IPA_PATH" ]]; then
  echo "❌ IPA not found: $IPA_PATH" >&2
  exit 1
fi

API_KEY_DIR="${RUNNER_TEMP:-/tmp}/private_keys"
mkdir -p "$API_KEY_DIR"
API_KEY_PATH="$API_KEY_DIR/AuthKey_${KEY_ID}.p8"

echo "$KEY_CONTENT_BASE64" | base64 --decode > "$API_KEY_PATH"
chmod 600 "$API_KEY_PATH"

echo "🚀 Validating IPA with altool..."
xcrun altool --validate-app -f "$IPA_PATH" -t ios   --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"   --output-format xml

echo "☁️ Uploading IPA to App Store Connect (TestFlight)..."
xcrun altool --upload-app -f "$IPA_PATH" -t ios   --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"   --output-format xml

rm -rf "$API_KEY_DIR"
echo "✅ Upload finished"

