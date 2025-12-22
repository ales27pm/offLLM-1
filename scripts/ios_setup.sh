#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${ROOT_DIR}/ios"

log()  { printf "%s\n" "$*"; }
info() { printf "ℹ️ %s\n" "$*"; }
err()  { printf "❌ %s\n" "$*"; }
ok()   { printf "✅ %s\n" "$*"; }

is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }

main() {
  if ! is_macos; then
    err "iOS setup must run on macOS (needs Xcode). Current OS: $(uname -s)"
    exit 2
  fi

  if [[ ! -d "${IOS_DIR}" ]]; then
    err "Missing ios directory: ${IOS_DIR}"
    exit 2
  fi

  info "Running iOS doctor..."
  bash "${ROOT_DIR}/scripts/ios_doctor.sh"

  info "Generating Xcode project via XcodeGen..."
  if [[ -f "${IOS_DIR}/project.yml" || -f "${IOS_DIR}/project.yaml" ]]; then
    (cd "${IOS_DIR}" && xcodegen generate)
  elif [[ -f "${ROOT_DIR}/project.yml" || -f "${ROOT_DIR}/project.yaml" ]]; then
    (cd "${ROOT_DIR}" && xcodegen generate)
  else
    err "No project.yml found. Cannot run xcodegen deterministically."
    exit 3
  fi
  ok "Xcode project generation done."

  info "Installing Ruby gems..."
  if [[ -f "${IOS_DIR}/Gemfile" ]]; then
    (cd "${IOS_DIR}" && bundle install)
  elif [[ -f "${ROOT_DIR}/Gemfile" ]]; then
    (cd "${ROOT_DIR}" && bundle install)
  else
    info "No Gemfile found. Skipping bundle install."
  fi

  info "Running CocoaPods..."
  if [[ -f "${IOS_DIR}/Podfile" ]]; then
    (cd "${IOS_DIR}" && bundle exec pod install --repo-update)
  else
    err "No Podfile found in ios/. Cannot run pod install."
    exit 3
  fi

  if compgen -G "${IOS_DIR}/*.xcworkspace" > /dev/null; then
    ok "Workspace created:"
    ls -1 "${IOS_DIR}"/*.xcworkspace
  else
    err "No .xcworkspace found after pod install in: ${IOS_DIR}"
    exit 4
  fi

  ok "iOS setup complete."
}

main "$@"
