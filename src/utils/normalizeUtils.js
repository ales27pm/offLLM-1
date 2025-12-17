const toTrimmedString = (value) =>
  typeof value === "string" ? value.trim() : "";

export const DEFAULT_PROVIDER = "google";
export const DEFAULT_TIME_RANGE = "any";
export const DEFAULT_MAX_RESULTS = 5;
export const MAX_RESULTS_CAP = 20;
export const DEFAULT_SAFE_SEARCH = true;

export const SUPPORTED_PROVIDERS = new Set([
  "google",
  "bing",
  "duckduckgo",
  "brave",
]);

export const SUPPORTED_TIME_RANGES = new Set([
  "day",
  "week",
  "month",
  "year",
  "any",
]);

export const normalizeProvider = (value) => {
  if (typeof value !== "string") {
    return DEFAULT_PROVIDER;
  }
  const normalised = value.trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(normalised) ? normalised : DEFAULT_PROVIDER;
};

export const normalizeTimeRange = (value) => {
  if (typeof value !== "string") {
    return DEFAULT_TIME_RANGE;
  }
  const normalised = value.trim().toLowerCase();
  return SUPPORTED_TIME_RANGES.has(normalised)
    ? normalised
    : DEFAULT_TIME_RANGE;
};

export const normalizeSafeSearch = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return DEFAULT_SAFE_SEARCH;
};

export const normalizeMaxResults = (value) => {
  const numeric =
    typeof value === "number" && !Number.isNaN(value)
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : DEFAULT_MAX_RESULTS;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX_RESULTS;
  }

  const integer = Math.floor(numeric);
  if (integer < 1) {
    return 1;
  }
  if (integer > MAX_RESULTS_CAP) {
    return MAX_RESULTS_CAP;
  }
  return integer;
};

export const normalizeSearchResults = (results, limit) => {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const title =
        toTrimmedString(item.title) ||
        toTrimmedString(item.name) ||
        toTrimmedString(item.url);
      const url = toTrimmedString(item.url);
      const snippet =
        toTrimmedString(item.snippet) ||
        toTrimmedString(item.description) ||
        toTrimmedString(item.content);

      if (!title && !url && !snippet) {
        return null;
      }

      return {
        title,
        url,
        snippet,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
};
