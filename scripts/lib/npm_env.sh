# shellcheck shell=bash

# Normalizes proxy-related npm environment variables so newer npm releases
# stop warning about the deprecated `npm_config_http_proxy` name. The helper
# prefers the modern `npm_config_proxy` key and reuses any standard HTTP(S)
# proxy variables that may already be exported.
sanitize_npm_proxy_env() {
  local http_proxy_val=""
  if [ -n "${npm_config_http_proxy:-}" ]; then
    http_proxy_val="${npm_config_http_proxy}"
  elif [ -n "${NPM_CONFIG_HTTP_PROXY:-}" ]; then
    http_proxy_val="${NPM_CONFIG_HTTP_PROXY}"
  elif [ -n "${HTTP_PROXY:-}" ]; then
    http_proxy_val="${HTTP_PROXY}"
  fi

  local https_proxy_val=""
  if [ -n "${npm_config_https_proxy:-}" ]; then
    https_proxy_val="${npm_config_https_proxy}"
  elif [ -n "${NPM_CONFIG_HTTPS_PROXY:-}" ]; then
    https_proxy_val="${NPM_CONFIG_HTTPS_PROXY}"
  elif [ -n "${HTTPS_PROXY:-}" ]; then
    https_proxy_val="${HTTPS_PROXY}"
  fi

  local normalized=0

  if [ -n "$http_proxy_val" ]; then
    if [ "${npm_config_proxy:-}" != "$http_proxy_val" ]; then
      export npm_config_proxy="$http_proxy_val"
    fi
    if [ "${NPM_CONFIG_PROXY:-}" != "$http_proxy_val" ]; then
      export NPM_CONFIG_PROXY="$http_proxy_val"
    fi
    unset npm_config_http_proxy
    unset NPM_CONFIG_HTTP_PROXY
    normalized=1
  fi

  if [ -n "$https_proxy_val" ]; then
    if [ "${npm_config_https_proxy:-}" != "$https_proxy_val" ]; then
      export npm_config_https_proxy="$https_proxy_val"
    fi
    if [ "${NPM_CONFIG_HTTPS_PROXY:-}" != "$https_proxy_val" ]; then
      export NPM_CONFIG_HTTPS_PROXY="$https_proxy_val"
    fi
  fi

  if [ "$normalized" -eq 1 ] && [ -z "${OFFLLM_NPM_PROXY_WARNED:-}" ]; then
    printf 'ℹ️  Normalized npm proxy environment for future npm compatibility.\n' >&2
    export OFFLLM_NPM_PROXY_WARNED=1
  fi
}




