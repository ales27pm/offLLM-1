#!/usr/bin/env bash
# Select an installed Xcode and ensure the iPhoneOS (device) SDK exists.
#
# Usage:
#   bash scripts/ci/select_xcode_and_ensure_ios.sh "16"
#   bash scripts/ci/select_xcode_and_ensure_ios.sh "26"
#   bash scripts/ci/select_xcode_and_ensure_ios.sh "auto"
#
# Behavior:
#  - If a numeric major is provided, tries that major first.
#  - If iphoneos SDK is missing, runs first-launch + tries to download iOS platform.
#  - If still missing, falls back across other majors found on the runner (prefer newest).
#
# This avoids the failure mode you hit: "No installed Xcode 16.x with iphoneos SDK".
set -euo pipefail

log() { printf '[xcode-select+ios] %s\n' "$1"; }
warn() { printf '::warning::%s\n' "$1"; }
die() { printf '::error::%s\n' "$1" >&2; exit 1; }

REQ_MAJOR="${1:-auto}"

# --- Discover installed Xcodes ------------------------------------------------

discover_devdirs() {
  local devdirs=()

  # Prefer Spotlight metadata
  if [[ -x /usr/bin/mdfind ]]; then
    local query="kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'"
    while IFS= read -r app; do
      [[ -z "$app" ]] && continue
      [[ -d "$app/Contents/Developer" ]] || continue
      devdirs+=("$app/Contents/Developer")
    done < <(/usr/bin/mdfind "$query" 2>/dev/null || true)
  fi

  # Fallback enumerate /Applications
  for app in /Applications/Xcode*.app /Applications/Xcode.app; do
    [[ -d "$app/Contents/Developer" ]] || continue
    devdirs+=("$app/Contents/Developer")
  done

  # De-dupe preserve order
  local uniq=() seen=""
  for d in "${devdirs[@]}"; do
    if [[ "$seen" != *"|$d|"* ]]; then
      uniq+=("$d")
      seen="${seen}|${d}|"
    fi
  done

  printf '%s\n' "${uniq[@]}"
}

version_of_devdir() {
  local devdir="$1"
  local app="${devdir%/Contents/Developer}"
  local plist="$app/Contents/Info.plist"
  if [[ -f "$plist" ]]; then
    /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || true
  fi
}

major_of_version() {
  local v="$1"
  printf '%s' "${v%%.*}"
}

# Compare dotted versions: return 0 if $1 > $2
ver_gt() {
  local a="$1" b="$2"
  [[ -z "$b" ]] && return 0
  IFS='.' read -r -a aa <<<"$a"
  IFS='.' read -r -a bb <<<"$b"
  local i max
  max="${#aa[@]}"
  [[ "${#bb[@]}" -gt "$max" ]] && max="${#bb[@]}"
  for ((i=0; i<max; i++)); do
    local ai="${aa[i]:-0}"
    local bi="${bb[i]:-0}"
    if ((10#$ai > 10#$bi)); then return 0; fi
    if ((10#$ai < 10#$bi)); then return 1; fi
  done
  return 1
}

has_iphoneos_sdk_active() {
  xcrun --sdk iphoneos --show-sdk-version >/dev/null 2>&1
}

dump_sdks() {
  log "xcodebuild -version:"
  xcodebuild -version || true
  log "xcodebuild -showsdks:"
  xcodebuild -showsdks || true
  log "xcrun --sdk iphoneos --show-sdk-version:"
  xcrun --sdk iphoneos --show-sdk-version || true
}

try_install_ios_platform() {
  log "Running first-launch…"
  sudo xcodebuild -runFirstLaunch || true

  # Attempt platform download (may fail depending on runner tooling / Apple gating)
  log "Attempting: xcodebuild -downloadPlatform iOS"
  sudo xcodebuild -downloadPlatform iOS || true
}

# Build list of devdirs with versions
mapfile -t ALL_DEVDIRS < <(discover_devdirs)

if [[ "${#ALL_DEVDIRS[@]}" -eq 0 ]]; then
  die "No Xcode installations found."
fi

log "Discovered ${#ALL_DEVDIRS[@]} Xcode developer dirs."
# Print a compact inventory
for d in "${ALL_DEVDIRS[@]}"; do
  v="$(version_of_devdir "$d")"
  log " - $d (Xcode ${v:-unknown})"
done

# Determine majors available, preferring newest
declare -A majors_best_devdir=()
declare -A majors_best_version=()

for d in "${ALL_DEVDIRS[@]}"; do
  v="$(version_of_devdir "$d")"
  [[ -n "$v" ]] || continue
  m="$(major_of_version "$v")"
  cur="${majors_best_version[$m]:-}"
  if ver_gt "$v" "$cur"; then
    majors_best_version["$m"]="$v"
    majors_best_devdir["$m"]="$d"
  fi
done

# Make an ordered list of majors (descending by numeric value)
majors=()
for k in "${!majors_best_version[@]}"; do majors+=("$k"); done
IFS=$'\n' majors=($(printf '%s\n' "${majors[@]}" | awk 'NF' | sort -nr)) || true
unset IFS

if [[ "${#majors[@]}" -eq 0 ]]; then
  die "Could not parse Xcode versions from installed apps."
fi

log "Available Xcode majors (newest first): ${majors[*]}"

# Build trial order:
trial=()
if [[ "$REQ_MAJOR" == "auto" ]]; then
  trial=("${majors[@]}")
else
  if ! [[ "$REQ_MAJOR" =~ ^[0-9]+$ ]]; then
    die "Invalid argument: '$REQ_MAJOR' (use a number like 16, 26, or 'auto')"
  fi
  trial+=("$REQ_MAJOR")
  for m in "${majors[@]}"; do
    [[ "$m" == "$REQ_MAJOR" ]] && continue
    trial+=("$m")
  done
fi

log "Trial order: ${trial[*]}"

# --- Try majors until we end up with a working iphoneos SDK -------------------

for m in "${trial[@]}"; do
  devdir="${majors_best_devdir[$m]:-}"
  ver="${majors_best_version[$m]:-}"
  if [[ -z "$devdir" || -z "$ver" ]]; then
    continue
  fi

  log "Selecting Xcode $ver (major=$m): $devdir"
  sudo xcode-select -s "$devdir"

  dump_sdks

  if has_iphoneos_sdk_active; then
    log "✅ iphoneos SDK already present under Xcode $ver"
    exit 0
  fi

  warn "iphoneos SDK missing under Xcode $ver — attempting to install/download iOS platform."
  try_install_ios_platform

  dump_sdks
  if has_iphoneos_sdk_active; then
    log "✅ iphoneos SDK now present under Xcode $ver"
    exit 0
  fi

  warn "Still no iphoneos SDK under Xcode $ver. Trying next major…"
done

die "No installed Xcode on this runner could provide an iphoneos SDK (device platform). Switch runner image (e.g., macos-14) or use an image that includes iOS platforms."
