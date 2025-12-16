#!/usr/bin/env bash
# shellcheck shell=bash
#
# Helpers for keeping the Xcode build environment noise-free.
# Xcode 16.4+ emits hundreds of warnings when legacy Swift debug
# information overrides are injected via the environment. Many of our
# workflows source `.env` files, so this helper centralises the cleanup
# before we call `xcodebuild`.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "xcode_env.sh should be sourced, not executed." >&2
  exit 1
fi

sanitize_xcode_env() {
  local var
  for var in SWIFT_DEBUG_INFORMATION_FORMAT SWIFT_DEBUG_INFORMATION_VERSION; do
    if [ -n "${!var+x}" ]; then
      printf 'info: unsetting %s to avoid Xcode warnings\n' "$var" >&2
      unset "$var"
    fi
  done
}



