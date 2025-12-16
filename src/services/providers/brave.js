import { getApiKeys } from "../utils/apiKeys";
import { brave as mapTime } from "../utils/timeRange";

export async function validateKey() {
  const { BRAVE_API_KEY } = await getApiKeys();
  return Boolean(BRAVE_API_KEY);
}

export async function search(query, { maxResults, timeRange, safeSearch }) {
  const { BRAVE_API_KEY } = await getApiKeys();
  if (!BRAVE_API_KEY) {
    throw new Error("Missing Brave key");
  }
  const freshness = mapTime[timeRange] || "";
  const url =
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}` +
    `&count=${maxResults}&freshness=${freshness}&safesearch=${safeSearch ? "moderate" : "off"}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": BRAVE_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`Brave Error: ${res.statusText}`);
  const data = await res.json();
  return (
    data.web?.results?.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
      date: item.age || null,
    })) || []
  );
}



