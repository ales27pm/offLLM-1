#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${ROOT_DIR}/ios"

log()  { printf "%s\n" "$*"; }
info() { printf "ℹ️ %s\n" "$*"; }
warn() { printf "⚠️ %s\n" "$*"; }
err()  { printf "❌ %s\n" "$*"; }
ok()   { printf "✅ %s\n" "$*"; }

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

is_macos() {
  [[ "$(uname -s)" == "Darwin" ]]
}

main() {
  info "offLLM iOS doctor"
  info "root: ${ROOT_DIR}"
  info "ios:  ${IOS_DIR}"

  if [[ ! -d "${IOS_DIR}" ]]; then
    err "Missing ios/ directory at: ${IOS_DIR}"
    exit 2
  fi

  if ! is_macos; then
    warn "You are on $(uname -s). iOS builds require macOS + Xcode."
    warn "Skipping iOS native generation. This is expected on Linux."
    warn ""
    warn "What you CAN do on Linux:"
    warn "  - npm ci"
    warn "  - npm test / npm run lint"
    warn "  - Android builds (Gradle)"
    warn "  - Run CI on GitHub macOS runners for iOS artifacts"
    warn ""
    warn "What you CANNOT do on Linux:"
    warn "  - xcodegen generate"
    warn "  - pod install"
    warn "  - xcodebuild / run-ios"
    exit 0
  fi

  # macOS checks below
  ok "macOS detected"

  if ! require_cmd xcodebuild; then
    err "xcodebuild not found. Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
    exit 3
  fi
  ok "xcodebuild present"

  if ! require_cmd ruby; then
    err "ruby not found. Install Ruby (system Ruby is usually OK on macOS)."
    exit 3
  fi
  ok "ruby present"

  if ! require_cmd bundle; then
    err "bundler not found. Install: gem install bundler"
    exit 3
  fi
  ok "bundler present"

  if ! require_cmd pod; then
    err "cocoapods not found. Install: sudo gem install cocoapods"
    exit 3
  fi
  ok "cocoapods present"

  if ! require_cmd xcodegen; then
    warn "xcodegen not found."
    warn "Install via Homebrew: brew install xcodegen"
    err "Cannot continue without xcodegen."
    exit 3
  fi
  ok "xcodegen present"

  if [[ ! -f "${IOS_DIR}/project.yml" && ! -f "${IOS_DIR}/project.yaml" && ! -f "${ROOT_DIR}/project.yml" && ! -f "${ROOT_DIR}/project.yaml" ]]; then
    warn "No project.yml found in ios/ or repo root."
    warn "If you rely on XcodeGen, ensure project.yml exists."
  fi

  ok "iOS doctor checks passed."
}

main "$@"
