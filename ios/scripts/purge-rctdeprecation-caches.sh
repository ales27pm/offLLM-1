#!/usr/bin/env bash
set -uo pipefail

candidate_roots=()

log_info() {
  printf '[purge-rctdeprecation] %s\n' "$1"
}

log_warn() {
  printf '[purge-rctdeprecation] %s\n' "$1" >&2
}

append_candidate() {
  local raw="$1"

  if [ -z "$raw" ]; then
    return 0
  fi

  if [ ! -e "$raw" ]; then
    return 0
  fi

  local probe="$raw"
  if [ ! -d "$probe" ]; then
    probe="$(dirname "$probe")"
    if [ ! -d "$probe" ]; then
      return 0
    fi
  fi

  local canonical
  if ! canonical="$(cd "$probe" 2>/dev/null && pwd -P)"; then
    log_warn "Skipping unreadable derived data root $probe"
    return 0
  fi

  local existing
  if [ "${#candidate_roots[@]}" -ne 0 ]; then
    for existing in "${candidate_roots[@]}"; do
      if [ "$existing" = "$canonical" ]; then
        return 0
      fi
    done
  fi

  candidate_roots+=("$canonical")
}

safe_remove_dir() {
  local target="$1"
  if rm -rf "$target"; then
    return 0
  fi

  log_warn "Warning: failed to remove directory $target"
  return 1
}

safe_remove_file() {
  local target="$1"
  if rm -f "$target"; then
    return 0
  fi

  log_warn "Warning: failed to remove file $target"
  return 1
}

remove_matches() {
  local description="$1"
  local root="$2"
  shift 2

  if [ ! -d "$root" ]; then
    return 0
  fi

  local status=0

  while IFS= read -r -d '' path; do
    if [ -z "$path" ]; then
      continue
    fi

    if [ -d "$path" ]; then
      log_info "Removing $description directory $path"
      safe_remove_dir "$path" || status=1
    else
      log_info "Removing $description file $path"
      safe_remove_file "$path" || status=1
    fi
  done < <(find "$root" "$@" -print0 2>/dev/null || true)

  return "$status"
}

main() {
  if [ -z "${BASH_VERSION:-}" ]; then
    log_warn "Bash was not detected; skipping purge"
    return 0
  fi

  local bash_major="${BASH_VERSINFO[0]:-0}"
  if [ "$bash_major" -lt 3 ]; then
    log_warn "Bash 3.0 or newer is required; skipping purge"
    return 0
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

  local project_dir_default
  project_dir_default="$(cd "${script_dir}/.." && pwd -P)"

  local project_dir_source="${PROJECT_DIR:-$project_dir_default}"
  local project_dir
  if ! project_dir="$(cd "${project_dir_source}" 2>/dev/null && pwd -P)"; then
    log_warn "Unable to resolve project directory from ${project_dir_source}; skipping purge"
    return 0
  fi

  local project_root
  if ! project_root="$(cd "${project_dir}/.." 2>/dev/null && pwd -P)"; then
    log_warn "Unable to resolve project root from ${project_dir}/..; skipping purge"
    return 0
  fi

  local app_target="${APP_TARGET:-monGARS}"
  local module_name="${MODULE_NAME:-RCTDeprecation}"
  local legacy_module_map_name="${LEGACY_MODULE_MAP_NAME:-RCTDeprecation.modulemap}"

  candidate_roots=()

  append_candidate "${DERIVED_DATA_DIR:-}"
  append_candidate "${DERIVED_DATA:-}"
  append_candidate "${OBJROOT:-}"
  append_candidate "${SYMROOT:-}"
  append_candidate "${project_root}/build/DerivedData"
  append_candidate "${HOME:-}/Library/Developer/Xcode/DerivedData"

  if [ "${#candidate_roots[@]}" -eq 0 ]; then
    log_info "No derived data roots to inspect"
    return 0
  fi

  local overall_status=0
  local root

  for root in "${candidate_roots[@]}"; do
    remove_matches "bridging header cache" "$root" -type f -name "${app_target}-Bridging-Header-swift*.pch" || overall_status=1
    remove_matches "module cache" "$root" -path "*ModuleCache.noindex*" -name "*${module_name}*" || overall_status=1
    remove_matches "legacy module map" "$root" -type f -name "${legacy_module_map_name}" || overall_status=1
  done

  if [ "$overall_status" -ne 0 ]; then
    log_warn "Completed with warnings"
  fi

  return 0
}

status=0
main "$@" || status=$?

if [ "$status" -ne 0 ]; then
  log_warn "Unexpected error while purging caches (exit $status); skipping purge"
fi

exit 0



