#!/usr/bin/env bash
# Import signing assets into a temporary keychain for CI workflows.
#
# Usage: import_signing.sh <p12-path> <p12-password> <mobileprovision-path> <keychain-name-or-path> <keychain-password>
# - Supports keychain arguments that are names, absolute paths, relative paths, or home-relative paths.
# - Emits PROFILE_UUID and KEYCHAIN_PATH for downstream GitHub Actions steps.
# - Persists ORIGINAL_KEYCHAIN_LIST and ORIGINAL_DEFAULT_KEYCHAIN so cleanup steps can restore prior macOS keychain state.
# - Enables verbose logging via `set -x` while masking sensitive arguments.

set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "::error ::Expected 5 arguments, received $#" >&2
  exit 1
fi

P12_PATH="$1"
P12_PASSWORD="$2"
MP_PATH="$3"
KC_ARG="$4"
KC_PASS="$5"

# Mask secrets in GitHub Actions logs
echo "::add-mask::$P12_PASSWORD"
echo "::add-mask::$KC_PASS"

if [[ ! -f "$P12_PATH" ]]; then
  echo "::error ::P12 not found at $P12_PATH" >&2
  exit 1
fi

if [[ ! -f "$MP_PATH" ]]; then
  echo "::error ::Provisioning profile not found at $MP_PATH" >&2
  exit 1
fi

if [[ -z "${KC_ARG// }" ]]; then
  echo "::error ::Keychain name or path must be provided" >&2
  exit 1
fi

if [[ -z "${KC_PASS// }" ]]; then
  echo "::error ::Keychain password must not be empty" >&2
  exit 1
fi

resolve_keychain_path() {
  local arg="$1"
  case "$arg" in
    /*)
      printf '%s' "$arg"
      ;;
    ~*|*/*)
      python3 -c 'import os, sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$arg"
      ;;
    *)
      printf '%s' "$HOME/Library/Keychains/$arg"
      ;;
  esac
}

KC_PATH="$(resolve_keychain_path "$KC_ARG")"
mkdir -p "$(dirname "$KC_PATH")"

log() {
  printf '::notice ::%s\n' "$1"
}

append_github_env_lines() {
  local key="$1"
  shift || true

  local env_file="${GITHUB_ENV:-}"
  if [[ -z "$env_file" ]]; then
    return 0
  fi

  if [[ -z "$key" || "$key" == *"="* ]]; then
    printf '::warning ::Skipping write: invalid env var name "%s"\n' "$key" >&2
    return 0
  fi

  local restore_xtrace=0
  if [[ $- == *x* ]]; then
    restore_xtrace=1
    set +x
  fi

  local delim="EOF_$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
  {
    printf '%s<<%s\n' "$key" "$delim"
    if [[ $# -gt 0 ]]; then
      printf '%s\n' "$@"
    else
      printf '\n'
    fi
    printf '%s\n' "$delim"
  } >>"$env_file"

  if [[ $restore_xtrace -eq 1 ]]; then
    set -x
  fi

  return 0
}

KEYCHAIN_CREATED=0
SEARCH_LIST_UPDATED=0
DEFAULT_KEYCHAIN_UPDATED=0
KEYCHAIN_LIST_TMP=""
PLIST_TMP=""
ORIGINAL_DEFAULT_KEYCHAIN=""
ORIGINAL_KEYCHAINS=()

cleanup_tmp_files() {
  if [[ -n "$KEYCHAIN_LIST_TMP" && -f "$KEYCHAIN_LIST_TMP" ]]; then
    rm -f "$KEYCHAIN_LIST_TMP"
  fi
  if [[ -n "$PLIST_TMP" && -f "$PLIST_TMP" ]]; then
    rm -f "$PLIST_TMP"
  fi
}

cleanup() {
  local exit_code=$1
  trap - EXIT
  set +x
  set +e
  cleanup_tmp_files
  if [[ $exit_code -ne 0 ]]; then
    if [[ $DEFAULT_KEYCHAIN_UPDATED -eq 1 ]]; then
      if [[ -n "$ORIGINAL_DEFAULT_KEYCHAIN" ]]; then
        security default-keychain -s "$ORIGINAL_DEFAULT_KEYCHAIN" >/dev/null 2>&1 || true
      else
        local login_kc="$HOME/Library/Keychains/login.keychain-db"
        [[ -f "$login_kc" ]] || login_kc="$HOME/Library/Keychains/login.keychain"
        security default-keychain -s "$login_kc" >/dev/null 2>&1 || true
      fi
    fi
    if [[ $SEARCH_LIST_UPDATED -eq 1 ]]; then
      if [[ ${#ORIGINAL_KEYCHAINS[@]} -gt 0 ]]; then
        security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
      else
        local login_kc="$HOME/Library/Keychains/login.keychain-db"
        [[ -f "$login_kc" ]] || login_kc="$HOME/Library/Keychains/login.keychain"
        local system_kc="/Library/Keychains/System.keychain"
        if [[ -f "$system_kc" ]]; then
          security list-keychains -d user -s "$login_kc" "$system_kc" >/dev/null 2>&1 || true
        else
          security list-keychains -d user -s "$login_kc" >/dev/null 2>&1 || true
        fi
      fi
    fi
    if [[ $KEYCHAIN_CREATED -eq 1 ]]; then
      security delete-keychain "$KC_PATH" >/dev/null 2>&1 || true
    fi
  fi
  exit "$exit_code"
}

trap 'cleanup $?' EXIT

log "Importing signing assets into keychain: $KC_PATH"

set -x

security delete-keychain "$KC_PATH" >/dev/null 2>&1 || true

set +x
security create-keychain -p "$KC_PASS" "$KC_PATH"
KEYCHAIN_CREATED=1
set -x

set +x
security set-keychain-settings -lut 21600 "$KC_PATH"
set -x

set +x
security unlock-keychain -p "$KC_PASS" "$KC_PATH"
set -x

set +x
security import "$P12_PATH" -k "$KC_PATH" -P "$P12_PASSWORD" -f pkcs12 -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/xcodebuild
set -x

set +x
security set-key-partition-list -S apple-tool:,apple: -s -k "$KC_PASS" "$KC_PATH" >/dev/null 2>&1 || true
set -x

set +x
DEFAULT_OUT="$(security default-keychain 2>/dev/null || true)"
set -x
if [[ -n "$DEFAULT_OUT" ]]; then
  ORIGINAL_DEFAULT_KEYCHAIN="$(printf '%s' "$DEFAULT_OUT" | sed -e 's/^[[:space:]]*"//' -e 's/"$//')"
  if [[ -n "$ORIGINAL_DEFAULT_KEYCHAIN" ]]; then
    append_github_env_lines "ORIGINAL_DEFAULT_KEYCHAIN" "$ORIGINAL_DEFAULT_KEYCHAIN"
  fi
else
  log "Unable to determine current default keychain; cleanup will fall back to login keychain"
fi

KEYCHAIN_LIST_TMP="$(mktemp)"
RESTORE_KEYCHAINS=("$KC_PATH")
if security list-keychains -d user >"$KEYCHAIN_LIST_TMP"; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim leading whitespace and surrounding quotes.
    line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*"//' -e 's/"$//')"
    [[ -z "$line" ]] && continue
    ORIGINAL_KEYCHAINS+=("$line")
    [[ "$line" == "$KC_PATH" ]] && continue
    RESTORE_KEYCHAINS+=("$line")
  done <"$KEYCHAIN_LIST_TMP"
  if [[ ${#ORIGINAL_KEYCHAINS[@]} -gt 0 ]]; then
    append_github_env_lines "ORIGINAL_KEYCHAIN_LIST" "${ORIGINAL_KEYCHAINS[@]}"
  fi
else
  log "Unable to read existing keychain search list; defaulting to $KC_PATH only"
fi

add_keychain_if_exists() {
  local candidate="$1"
  if [[ -z "$candidate" || ! -e "$candidate" ]]; then
    return 0
  fi
  local already_present=0
  for existing in "${RESTORE_KEYCHAINS[@]}"; do
    if [[ "$existing" == "$candidate" ]]; then
      already_present=1
      break
    fi
  done
  if [[ $already_present -eq 0 ]]; then
    RESTORE_KEYCHAINS+=("$candidate")
  fi
  return 0
}

add_keychain_if_exists "/Library/Keychains/System.keychain"
add_keychain_if_exists "/System/Library/Keychains/SystemRootCertificates.keychain"

security list-keychains -d user -s "${RESTORE_KEYCHAINS[@]}"
SEARCH_LIST_UPDATED=1

security default-keychain -s "$KC_PATH"
DEFAULT_KEYCHAIN_UPDATED=1

PP_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$PP_DIR"
PLIST_TMP="$(mktemp)"

set +x
security cms -D -i "$MP_PATH" > "$PLIST_TMP"
set -x

UUID=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$PLIST_TMP")
PROFILE_NAME=$(/usr/libexec/PlistBuddy -c 'Print Name' "$PLIST_TMP")
if [[ -z "$UUID" || -z "$PROFILE_NAME" ]]; then
  set +x
  echo "::error ::Failed to resolve provisioning profile metadata" >&2
  exit 1
fi
cp "$MP_PATH" "$PP_DIR/$UUID.mobileprovision"
rm -f "$PLIST_TMP"

set +x
append_github_env_lines "PROFILE_UUID" "$UUID"
append_github_env_lines "PROFILE_NAME" "$PROFILE_NAME"
append_github_env_lines "KEYCHAIN_PATH" "$KC_PATH"
set -x

log "Installed provisioning profile $PROFILE_NAME ($UUID)"

# Restore xtrace to default off for downstream scripts.
set +x



