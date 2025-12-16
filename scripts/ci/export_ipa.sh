#!/usr/bin/env bash
# Export an Xcode archive to an IPA with the provided export options.
# Usage: export_ipa.sh <archive-path> <export-options-plist> <export-directory>
#
# Environment variables:
#   EXPORT_TEAM_ID            - Preferred team identifier injected into export options
#   DEVELOPMENT_TEAM          - Fallback team identifier when EXPORT_TEAM_ID is unset
#   PROFILE_UUID              - Provisioning profile UUID to resolve a team identifier from disk
#   PRODUCT_BUNDLE_IDENTIFIER - Bundle identifier to associate with the provisioning profile
#   PROFILE_NAME              - Provisioning profile name recorded in export options for signing
#   EXPORT_METHOD             - (Optional) Export method to record in ExportOptions.plist (defaults to "development")
#   DEV_LABEL                 - (Optional) Apple Development signing certificate label hint
#   DIST_LABEL                - (Optional) Apple Distribution signing certificate label hint

set -euo pipefail
if [[ $# -ne 3 ]]; then
  echo "::error ::Usage: $0 <archive-path> <export-options-plist> <export-directory>" >&2
  exit 2
fi

ARCHIVE_PATH="$1"
EXPORT_OPTS="$2"
EXPORT_DIR="$3"

if [[ ! -d "$ARCHIVE_PATH" ]]; then
  echo "::error ::Archive not found (expected directory): $ARCHIVE_PATH" >&2
  exit 1
fi

EXPORT_OPTS_DIR="$(dirname "$EXPORT_OPTS")"
mkdir -p "$EXPORT_OPTS_DIR"

resolve_bundle_identifier_from_archive() {
  local archive="$1"

  if [[ ! -x /usr/libexec/PlistBuddy ]]; then
    return 1
  fi

  local archive_plist
  archive_plist="${archive}/Info.plist"
  if [[ -f "$archive_plist" ]]; then
    local bundle_id
    bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$archive_plist" 2>/dev/null || true)
    if [[ -n "${bundle_id// }" ]]; then
      printf '%s' "$bundle_id"
      return 0
    fi
  fi

  local info_plist
  info_plist="$(find "${archive}/Products/Applications" -maxdepth 2 -name 'Info.plist' 2>/dev/null | head -n 1 || true)"
  if [[ -n "${info_plist// }" && -f "$info_plist" ]]; then
    local bundle_id
    bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null || true)
    if [[ -n "${bundle_id// }" ]]; then
      printf '%s' "$bundle_id"
      return 0
    fi
  fi

  return 1
}

resolve_team_id_from_profile() {
  local uuid="${PROFILE_UUID:-}"
  if [[ -z "${uuid// }" ]]; then
    return 0
  fi

  local profile_path="$HOME/Library/MobileDevice/Provisioning Profiles/${uuid}.mobileprovision"
  if [[ ! -f "$profile_path" ]]; then
    return 0
  fi

  if ! command -v security >/dev/null 2>&1; then
    echo "::warning ::security command not available; unable to parse provisioning profile for team identifier" >&2
    return 0
  fi

  local plist_tmp
  plist_tmp="$(mktemp)"
  if ! security cms -D -i "$profile_path" >"$plist_tmp" 2>/dev/null; then
    rm -f "$plist_tmp"
    return 0
  fi

  local team_id=""
  if [[ -x /usr/libexec/PlistBuddy ]]; then
    team_id=$(/usr/libexec/PlistBuddy -c 'Print TeamIdentifier:0' "$plist_tmp" 2>/dev/null || true)
  fi

  rm -f "$plist_tmp"

  if [[ -n "${team_id// }" ]]; then
    printf '%s' "$team_id"
  fi

  return 0
}

TEAM_ID="${EXPORT_TEAM_ID:-}"
if [[ -z "${TEAM_ID// }" && -n "${DEVELOPMENT_TEAM:-}" ]]; then
  TEAM_ID="$DEVELOPMENT_TEAM"
fi

if [[ -z "${TEAM_ID// }" ]]; then
  TEAM_ID="$(resolve_team_id_from_profile)"
fi

BUNDLE_IDENTIFIER="${PRODUCT_BUNDLE_IDENTIFIER:-}"
if [[ -z "${BUNDLE_IDENTIFIER// }" ]]; then
  BUNDLE_IDENTIFIER="$(resolve_bundle_identifier_from_archive "$ARCHIVE_PATH" || true)"
fi

PROFILE_NAME="${PROFILE_NAME:-}"

if [[ -z "${BUNDLE_IDENTIFIER// }" ]]; then
  echo "::error ::BUNDLE_IDENTIFIER is empty; cannot build ExportOptions.plist" >&2
  exit 1
fi

if [[ -z "${PROFILE_NAME// }" ]]; then
  echo "::error ::PROFILE_NAME is empty; cannot build ExportOptions.plist" >&2
  exit 1
fi

validate_profile_team_alignment() {
  local uuid="${PROFILE_UUID:-}"
  if [[ -z "${uuid// }" ]]; then
    return 0
  fi

  local profile_path="$HOME/Library/MobileDevice/Provisioning Profiles/${uuid}.mobileprovision"
  if [[ ! -f "$profile_path" ]]; then
    return 0
  fi

  if ! command -v security >/dev/null 2>&1; then
    return 0
  fi

  local tmp_plist
  tmp_plist="$(mktemp)"
  if ! security cms -D -i "$profile_path" >"$tmp_plist" 2>/dev/null; then
    rm -f "$tmp_plist"
    return 0
  fi

  local app_id=""
  if [[ -x /usr/libexec/PlistBuddy ]]; then
    app_id=$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$tmp_plist" 2>/dev/null || true)
  fi

  rm -f "$tmp_plist"

  if [[ -n "${app_id// }" ]]; then
    local profile_team
    profile_team="${app_id%%.*}"
    if [[ -n "${TEAM_ID// }" && "$profile_team" != "$TEAM_ID" ]]; then
      echo "::error ::Provisioning profile team ($profile_team) does not match TEAM_ID ($TEAM_ID)" >&2
      exit 1
    fi
  fi
}

validate_profile_team_alignment

if ! command -v plutil >/dev/null 2>&1; then
  echo "::error ::plutil command is required to build ExportOptions.plist" >&2
  exit 1
fi

METHOD="${EXPORT_METHOD:-${METHOD:-development}}"
if [[ -z "${METHOD// }" ]]; then
  METHOD="development"
fi

rm -f "$EXPORT_OPTS"
plutil -create xml1 "$EXPORT_OPTS"
plutil -replace : -xml '<dict/>' "$EXPORT_OPTS"

plutil -insert method -string "$METHOD" "$EXPORT_OPTS"
plutil -insert signingStyle -string "manual" "$EXPORT_OPTS"

if [[ -n "${TEAM_ID// }" ]]; then
  plutil -insert teamID -string "$TEAM_ID" "$EXPORT_OPTS"
fi

if [[ -z "${BUNDLE_IDENTIFIER:-}" || -z "${PROFILE_NAME:-}" ]]; then
  echo "::error ::BUNDLE_IDENTIFIER or PROFILE_NAME is empty; cannot populate provisioningProfiles" >&2
  exit 1
fi

plutil -insert provisioningProfiles -xml '<dict/>' "$EXPORT_OPTS" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :provisioningProfiles dict" "$EXPORT_OPTS" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :provisioningProfiles:${BUNDLE_IDENTIFIER} string ${PROFILE_NAME}" "$EXPORT_OPTS" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :provisioningProfiles:${BUNDLE_IDENTIFIER} ${PROFILE_NAME}" "$EXPORT_OPTS"

if [[ "$METHOD" == "development" ]]; then
  cert_label="${DEV_LABEL:-}"
  if [[ -z "${cert_label// }" ]]; then
    cert_label="Apple Development"
  fi
  plutil -insert signingCertificate -string "$cert_label" "$EXPORT_OPTS"
else
  cert_label="${DIST_LABEL:-}"
  if [[ -z "${cert_label// }" ]]; then
    cert_label="Apple Distribution"
  fi
  plutil -insert signingCertificate -string "$cert_label" "$EXPORT_OPTS"
fi

plutil -insert stripSwiftSymbols -bool true "$EXPORT_OPTS"
plutil -insert compileBitcode -bool false "$EXPORT_OPTS"

echo "==== ExportOptions.plist ===="
if [[ -x /usr/libexec/PlistBuddy ]]; then
  /usr/libexec/PlistBuddy -c "Print" "$EXPORT_OPTS" || plutil -p "$EXPORT_OPTS"
else
  plutil -p "$EXPORT_OPTS"
fi

set -x

mkdir -p "$EXPORT_DIR"

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTS"

ls -la "$EXPORT_DIR"

set +x



