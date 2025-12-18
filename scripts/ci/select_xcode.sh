#!/usr/bin/env bash
# Select the newest *installed* Xcode matching a requested major version,
# but only if that Xcode has an iPhoneOS (device) SDK available.
#
# Usage:
#   bash scripts/ci/select_xcode.sh [major-version]
#
# Examples:
#   bash scripts/ci/select_xcode.sh 16
#   bash scripts/ci/select_xcode.sh 15
#
# Why the extra SDK check?
# GitHub macOS runners can have multiple Xcodes, and not every install always
# includes the iOS device platform. If we pick an Xcode without iphoneos,
# xcodebuild -destination "generic/platform=iOS" fails with exit 70.
set -euo pipefail

log() { printf '[select_xcode] %s\n' "$1"; }
die() { printf '::error ::%s\n' "$1" >&2; exit 1; }

MAJOR_VERSION="${1:-16}"
if ! [[ "$MAJOR_VERSION" =~ ^[0-9]+$ ]]; then
  die "Invalid major version: ${MAJOR_VERSION}"
fi

# Build a list of candidate developer dirs.
candidates=()

# Prefer Spotlight metadata (fast & accurate) when available.
if [[ -x /usr/bin/mdfind ]]; then
  query="kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'"
  while IFS= read -r app; do
    [[ -z "$app" ]] && continue
    if [[ -d "$app/Contents/Developer" ]]; then
      candidates+=("$app/Contents/Developer")
    fi
  done < <(/usr/bin/mdfind "$query" 2>/dev/null || true)
fi

# Fallback: enumerate /Applications
for app in /Applications/Xcode*.app /Applications/Xcode.app; do
  [[ -d "$app/Contents/Developer" ]] || continue
  candidates+=("$app/Contents/Developer")
done

# De-dupe while preserving order.
uniq=()
seen=""
for c in "${candidates[@]}"; do
  if [[ "$seen" != *"|$c|"* ]]; then
    uniq+=("$c")
    seen="${seen}|$c|"
  fi
done
candidates=("${uniq[@]}")

if [[ "${#candidates[@]}" -eq 0 ]]; then
  die "No Xcode installations found under Spotlight or /Applications"
fi

log "Found ${#candidates[@]} Xcode candidate(s). Filtering for major=${MAJOR_VERSION} + iphoneos SDK…"

best_devdir=""
best_version=""

version_of_devdir() {
  local devdir="$1"
  local app="${devdir%/Contents/Developer}"
  local plist="$app/Contents/Info.plist"
  if [[ -f "$plist" ]]; then
    /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || true
  fi
}

has_iphoneos_sdk() {
  local devdir="$1"
  # Use DEVELOPER_DIR so we don't have to xcode-select for the probe.
  DEVELOPER_DIR="$devdir" xcodebuild -showsdks 2>/dev/null | grep -qE '\biphoneos\b'
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

for devdir in "${candidates[@]}"; do
  [[ -d "$devdir" ]] || continue

  v="$(version_of_devdir "$devdir")"
  [[ -n "$v" ]] || continue

  major="${v%%.*}"
  [[ "$major" == "$MAJOR_VERSION" ]] || continue

  if ! has_iphoneos_sdk "$devdir"; then
    log "Skipping (no iphoneos SDK): $devdir (Xcode $v)"
    continue
  fi

  log "Candidate OK: $devdir (Xcode $v)"
  if ver_gt "$v" "$best_version"; then
    best_version="$v"
    best_devdir="$devdir"
  fi
done

if [[ -z "$best_devdir" ]]; then
  log "No installed Xcode ${MAJOR_VERSION}.x with iphoneos SDK was found."
  log "Installed Xcodes (for debugging):"
  ls -1 /Applications | grep -E '^Xcode.*\.app$' || true
  die "Cannot proceed: required iOS platform SDK missing on this runner for Xcode ${MAJOR_VERSION}.x"
fi

log "Switching to $best_devdir (Xcode $best_version)"
sudo xcode-select -s "$best_devdir"

log "Active Xcode:"
xcodebuild -version
xcodebuild -showsdks | sed 's/^/[showsdks] /'
