import { getEnv } from "../../config";

export async function getApiKeys() {
  return {
    GOOGLE_API_KEY: getEnv("GOOGLE_API_KEY"),
    GOOGLE_SEARCH_ENGINE_ID: getEnv("GOOGLE_SEARCH_ENGINE_ID"),
    BING_API_KEY: getEnv("BING_API_KEY"),
    BRAVE_API_KEY: getEnv("BRAVE_API_KEY"),
  };
}

export async function validate(provider) {
  const keys = await getApiKeys();
  switch (provider) {
    case "google":
      return !!(keys.GOOGLE_API_KEY && keys.GOOGLE_SEARCH_ENGINE_ID);
    case "bing":
      return !!keys.BING_API_KEY;
    case "brave":
      return !!keys.BRAVE_API_KEY;
    case "duckduckgo":
      return true;
    default:
      return false;
  }
}



