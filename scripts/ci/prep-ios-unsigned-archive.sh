#!/usr/bin/env bash
# Prepares the macOS CI runner for a deterministic unsigned iOS archive.
# The workflow delegates cache cleanup, Pod reinstall, React Native codegen,
# header validation, and legacy module map shims to this helper so the steps
# remain readable in GitHub Actions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IOS_DIR="${REPO_ROOT}/ios"
LOG_PREFIX="[prepare-ios-archive]"

log() {
  printf '%s %s\n' "${LOG_PREFIX}" "$*"
}

cd "${REPO_ROOT}"

log "Resetting DerivedData and module caches"
rm -rf "${HOME}/Library/Developer/Xcode/DerivedData"
rm -rf "${HOME}/Library/Caches/com.apple.dt.Xcode"
rm -rf "${REPO_ROOT}/build/DerivedData"
rm -rf "${REPO_ROOT}/build/DerivedData/ModuleCache.noindex"
rm -rf "${REPO_ROOT}/build/DerivedData/Build/Intermediates.noindex/ArchiveIntermediates"
rm -rf "${REPO_ROOT}/build/DerivedData/Build/Intermediates.noindex/PrecompiledHeaders"
MODULE_CACHE_DIR="$(mktemp -d)"
log "Using temporary clang module cache at ${MODULE_CACHE_DIR}"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "CLANG_MODULE_CACHE_PATH=${MODULE_CACHE_DIR}" >> "${GITHUB_ENV}"
else
  export CLANG_MODULE_CACHE_PATH="${MODULE_CACHE_DIR}"
fi

log "Removing cached Pods and Podfile.lock"
rm -rf "${IOS_DIR}/Pods" "${IOS_DIR}/Podfile.lock"

log "Ensuring Ruby gems and CocoaPods are installed"
USE_BUNDLER=0
if command -v bundle >/dev/null 2>&1; then
  if bundle check >/dev/null 2>&1; then
    USE_BUNDLER=1
  else
    if bundle install; then
      USE_BUNDLER=1
    else
      log "bundle install failed; continuing with system-wide CocoaPods"
    fi
  fi
else
  log "bundle command not found; falling back to system-wide CocoaPods"
fi

if ! command -v pod >/dev/null 2>&1; then
  log "CocoaPods (pod) command not found on PATH"
  exit 70
fi

pushd "${IOS_DIR}" >/dev/null
log "Updating CocoaPods repos"
if [[ "${USE_BUNDLER}" -eq 1 ]]; then
  bundle exec pod repo update
else
  pod repo update
fi

log "Installing Pods with --repo-update --clean-install"
if [[ "${USE_BUNDLER}" -eq 1 ]]; then
  bundle exec pod install --repo-update --clean-install
else
  pod install --repo-update --clean-install
fi
popd >/dev/null

log "Running React Native codegen"
if ! npx react-native --version >/dev/null 2>&1; then
  log "npx react-native --version failed (command may not exist); continuing"
fi
if ! npx react-native codegen; then
  log "React Native codegen exited with non-zero status; continuing so header validation can report context"
fi

log "Validating generated spec headers"
FOUND=0
HEADER_CANDIDATES=(
  "ios/Pods/Headers/Public/FBReactNativeSpec/FBReactNativeSpec/FBReactNativeSpec.h"
  "ios/Pods/Headers/Public/FBReactNativeSpec/FBReactNativeSpec.h"
  "ios/Pods/Headers/Public/FBReactNativeSpec/AppSpec.h"
  "ios/Pods/Headers/Public/AppSpec/LLMSpec.h"
  "ios/Pods/Headers/Public/AppSpecs/LLMSpec.h"
  "ios/Pods/Headers/Public/LLMSpec.h"
)
for header in "${HEADER_CANDIDATES[@]}"; do
  if [[ -f "${header}" ]]; then
    log "found header: ${header}"
    FOUND=1
  fi
done

if [[ "${FOUND}" -eq 0 ]]; then
  log "No generated headers found in expected locations"
  exit 64
fi

log "Purging any cached RCTDeprecation module artifacts"
if ! bash "${IOS_DIR}/scripts/purge-rctdeprecation-caches.sh"; then
  log "purge-rctdeprecation-caches.sh exited non-zero; continuing"
fi

log "Ensuring legacy RCTDeprecation.modulemap exists"
bash "${IOS_DIR}/scripts/ensure-rctdeprecation-legacy.sh"

log "iOS archive prerequisites complete"



