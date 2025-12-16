#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSINFO:-}" ]; then
  printf 'patch-mlx-metal-cxx17: this script must be executed with bash.\n' >&2
  exit 1
fi

if [ "${BASH_VERSINFO[0]}" -lt 3 ]; then
  printf 'patch-mlx-metal-cxx17: bash 3.0 or newer is required (found %s.%s).\n' \
    "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]-0}" >&2
  exit 1
fi

log() {
  printf '[patch-mlx-metal-cxx17] %s\n' "$1"
}

MARKER="offLLM:disable-metal-cxx17-warning"

apply_patch() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return
  fi

  local status
  status="$(python3 - "$file" "$MARKER" <<'PY'
import os
import sys
from typing import Tuple

path, marker = sys.argv[1], sys.argv[2]
try:
    with open(path, "r", encoding="utf-8") as fh:
        original = fh.read()
except FileNotFoundError:
    print("missing", end="")
    raise SystemExit(0)

if marker in original:
    print("already", end="")
    raise SystemExit(0)

prefix = (
    f"// {marker}\n"
    "#if defined(__clang__)\n"
    "#pragma clang diagnostic push\n"
    "#pragma clang diagnostic ignored \"-Wc++17-extensions\"\n"
    "#endif\n"
)

suffix = (
    "\n#if defined(__clang__)\n"
    "#pragma clang diagnostic pop\n"
    "#endif\n"
)

content = original
if not content.endswith("\n"):
    content += "\n"

patched = prefix + content + suffix

tmp_path = path + ".offllm.tmp"
with open(tmp_path, "w", encoding="utf-8") as fh:
    fh.write(patched)
os.replace(tmp_path, path)
print("patched", end="")
PY
)"

  case "$status" in
    patched)
      log "Applied diagnostic guard to ${file}"
      ;;
    already)
      log "Already guarded ${file}"
      ;;
    missing)
      log "File disappeared before patch: ${file}"
      ;;
    "")
      log "No changes required for ${file}"
      ;;
    *)
      log "Unexpected status '${status}' for ${file}"
      ;;
  esac
}

resolve_realpath() {
  python3 - "$1" <<'PY'
import os
import sys

path = sys.argv[1]
print(os.path.realpath(path))
PY
}

maybe_add_root() {
  local candidate="$1"
  if [ -z "$candidate" ]; then
    return
  fi
  if [ ! -d "$candidate" ]; then
    return
  fi

  local resolved
  if ! resolved="$(resolve_realpath "$candidate")"; then
    return
  fi

  candidate_roots+=("$resolved")
}

maybe_add_variations() {
  local base="$1"
  local depth="${2:-2}"

  if [ -z "$base" ]; then
    return
  fi

  local resolved
  if ! resolved="$(resolve_realpath "$base")"; then
    return
  fi

  local current="$resolved"
  local step=0

  while [ "$step" -le "$depth" ]; do
    maybe_add_root "$current/SourcePackages"
    maybe_add_root "$current/SourcePackages/checkouts"
    maybe_add_root "$current/build"
    maybe_add_root "$current/build/DerivedData"
    maybe_add_root "$current/build/DerivedData/SourcePackages"
    maybe_add_root "$current/build/DerivedData/SourcePackages/checkouts"
    maybe_add_root "$current/DerivedData"
    maybe_add_root "$current/DerivedData/SourcePackages"
    maybe_add_root "$current/DerivedData/SourcePackages/checkouts"

    local next
    next="$(dirname "$current")"
    if [ -z "$next" ] || [ "$next" = "$current" ]; then
      break
    fi

    current="$next"
    step=$((step + 1))
  done
}

array_contains() {
  local needle="$1"
  shift || true

  for item in "$@"; do
    if [ "$item" = "$needle" ]; then
      return 0
    fi
  done

  return 1
}

declare -a candidate_roots=()
declare -a temp_files=()

cleanup() {
  if [ -z "${temp_files+x}" ] || [ "${#temp_files[@]}" -eq 0 ]; then
    return
  fi

  for tmp in "${temp_files[@]}"; do
    if [ -n "$tmp" ]; then
      rm -f "$tmp" || true
    fi
  done
}

trap cleanup EXIT

make_tmp_file() {
  local tmp

  if tmp="$(mktemp 2>/dev/null)"; then
    printf '%s\n' "$tmp"
    return 0
  fi

  local dir="${TMPDIR:-/tmp}"
  if [ ! -d "$dir" ]; then
    dir="/tmp"
  fi

  tmp="$(mktemp "${dir%/}/patch-mlx-metal-cxx17.XXXXXX" 2>/dev/null)" || return 1
  printf '%s\n' "$tmp"
}

maybe_add_variations "${PROJECT_DIR:-}" 3
maybe_add_variations "${SRCROOT:-}" 3
maybe_add_variations "${PWD:-}" 3
maybe_add_variations "${DERIVED_DATA_DIR:-}" 1

maybe_add_root "$HOME/Library/Developer/Xcode/DerivedData"
maybe_add_root "$HOME/Library/Developer/Xcode/DerivedData/SourcePackages"
maybe_add_root "$HOME/Library/Developer/Xcode/DerivedData/SourcePackages/checkouts"

declare -a roots=()

if [ -n "${candidate_roots+x}" ]; then
  for candidate in "${candidate_roots[@]}"; do
    if [ -z "$candidate" ]; then
      continue
    fi
    if [ -n "${roots+x}" ] && array_contains "$candidate" "${roots[@]}"; then
      continue
    fi
    roots+=("$candidate")
  done
fi

if [ -z "${roots+x}" ] || [ "${#roots[@]}" -eq 0 ]; then
  log "No SourcePackages directories discovered; nothing to patch"
  exit 0
fi

patched_any=false

if [ -n "${roots+x}" ]; then
  for root in "${roots[@]}"; do
    tmp_file="$(make_tmp_file 2>/dev/null || true)"
    if [ -z "$tmp_file" ]; then
      log "Unable to allocate temporary file for ${root}; skipping"
      continue
    fi

    temp_files+=("$tmp_file")

    if ! find "$root" -maxdepth 15 \
      -path '*/mlx-swift/Source/Cmlx/mlx-generated/metal/steel/attn/kernels/steel_attention.h' \
      -print0 2>/dev/null >"$tmp_file"; then
      log "Failed to scan ${root} for mlx-swift headers"
      continue
    fi

    if [ ! -s "$tmp_file" ]; then
      continue
    fi

    while IFS= read -r -d '' file; do
      apply_patch "$file"
      patched_any=true
    done < "$tmp_file"
  done
fi

if [ "$patched_any" = false ]; then
  log "Did not locate mlx-swift steel_attention.h; nothing to patch"
fi



