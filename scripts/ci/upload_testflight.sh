#!/usr/bin/env bash
set -euo pipefail

IPA_PATH="${1:?ipa path required}"
ASC_KEY_ID="${2:?ASC key id required}"
ASC_ISSUER_ID="${3:?ASC issuer id required}"
ASC_PRIVATE_KEY_BASE64="${4:?ASC private key base64 required}"

clean_b64() { printf '%s' "$1" | tr -d '\n\r\t ' ; }
b64_decode_to() {
  local in="$1"; local out="$2"
  if base64 -D </dev/null >/dev/null 2>&1; then
    printf '%s' "$in" | base64 -D > "$out"
  else
    printf '%s' "$in" | base64 --decode > "$out"
  fi
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

p8="$tmpdir/AuthKey_${ASC_KEY_ID}.p8"
b64_decode_to "$(clean_b64 "$ASC_PRIVATE_KEY_BASE64")" "$p8"

echo "Uploading IPA via altool…"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA_PATH" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID" \
  --verbose
