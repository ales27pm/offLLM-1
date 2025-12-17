import { getApiKeys } from "../utils/apiKeys";
import { google as mapTime } from "../utils/timeRange";

export async function validateKey() {
  const { GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID } = await getApiKeys();
  return Boolean(GOOGLE_API_KEY && GOOGLE_SEARCH_ENGINE_ID);
}

export async function search(query, { maxResults, timeRange, safeSearch }) {
  const { GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID } = await getApiKeys();
  if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
    throw new Error("Missing Google key/config");
  }
  const dateRestrict = mapTime[timeRange] || "";
  const safe = safeSearch ? "medium" : "off";
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}` +
    `&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}&safe=${safe}` +
    (dateRestrict ? `&dateRestrict=${dateRestrict}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Error: ${res.statusText}`);
  const { items = [] } = await res.json();
  return items.map((i) => ({
    title: i.title,
    url: i.link,
    snippet: i.snippet,
    date: i.pagemap?.metatags?.[0]?.["article:published_time"] || null,
  }));
}
