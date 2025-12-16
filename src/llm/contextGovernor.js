const DEFAULT_MAX_CONTEXT = 2048;
const MIN_CONTEXT = 512;

let maxContext = DEFAULT_MAX_CONTEXT;

export function getMaxContext() {
  return maxContext;
}

export function setMaxContext(value) {
  maxContext = Math.max(MIN_CONTEXT, value | 0);
}

export function governContext(tokens) {
  if (tokens.length <= maxContext) return tokens;
  return tokens.slice(tokens.length - maxContext);
}

