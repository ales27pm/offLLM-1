#!/usr/bin/env bash
# Select the latest installed Xcode that matches the requested major version.
# Usage: select_xcode.sh [major-version]
# Defaults to major version 16.
set -euo pipefail

log() {
  printf '[select_xcode] %s\n' "$1"
}

die() {
  printf '::error ::%s\n' "$1" >&2
  exit 1
}

MAJOR_VERSION="${1:-16}"
if ! [[ "$MAJOR_VERSION" =~ ^[0-9]+$ ]]; then
  die "Invalid major version: ${MAJOR_VERSION}"
fi

minimum_version="${MAJOR_VERSION}.0"
next_major=$((MAJOR_VERSION + 1))

candidates=()

# Gather candidates via mdfind if available.
if [[ -x /usr/bin/mdfind ]]; then
  query="kMDItemCFBundleIdentifier = 'com.apple.dt.Xcode' && kMDItemVersion >= '${minimum_version}' && kMDItemVersion < '${next_major}.0'"
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ -d "$path/Contents/Developer" ]]; then
      candidates+=("$path/Contents/Developer")
    elif [[ -d "$path" ]]; then
      candidates+=("$path")
    fi
  done < <(/usr/bin/mdfind "$query" || true)
fi

# Fallback: list /Applications manually.
if [[ ${#candidates[@]} -eq 0 ]]; then
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    candidates+=("$path/Contents/Developer")
  done < <(ls -1d /Applications/Xcode_${MAJOR_VERSION}*.app 2>/dev/null | sort -V || true)
fi

if [[ ${#candidates[@]} -eq 0 ]]; then
  die "Could not find Xcode ${MAJOR_VERSION}.x on the machine"
fi

select_candidate=""
select_version="0"
for candidate in "${candidates[@]}"; do
  if [[ ! -x "$candidate/usr/bin/xcodebuild" ]]; then
    log "Skipping $candidate (missing xcodebuild)"
    continue
  fi

  app_bundle="$candidate"
  if [[ "$candidate" == */Contents/Developer ]]; then
    app_bundle="${candidate%/Contents/Developer}"
  fi
  info_plist="$app_bundle/Contents/Info.plist"
  version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist" 2>/dev/null || echo "0")
  if [[ -z "$version" ]]; then
    version="0"
  fi

  if [[ "$select_candidate" == "" ]]; then
    select_candidate="$candidate"
    select_version="$version"
    continue
  fi

  latest_version=$(printf '%s\n%s\n' "$version" "$select_version" | sort -V | tail -n1)
  if [[ "$latest_version" == "$version" && "$version" != "$select_version" ]]; then
    select_candidate="$candidate"
    select_version="$version"
  fi
done

if [[ -z "$select_candidate" ]]; then
  die "No valid Xcode developer directories found for version ${MAJOR_VERSION}.x"
fi

log "Switching to ${select_candidate} (version ${select_version})"
sudo xcode-select -s "$select_candidate"

log "Active Xcode:"
xcodebuild -version




