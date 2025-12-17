import { getApiKeys } from "../utils/apiKeys";
import { bing as mapTime } from "../utils/timeRange";

export async function validateKey() {
  const { BING_API_KEY } = await getApiKeys();
  return Boolean(BING_API_KEY);
}

export async function search(query, { maxResults, timeRange, safeSearch }) {
  const { BING_API_KEY } = await getApiKeys();
  if (!BING_API_KEY) {
    throw new Error("Missing Bing key");
  }
  const freshness = mapTime[timeRange] || "";
  const url =
    `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}` +
    `&count=${maxResults}&freshness=${freshness}&safeSearch=${safeSearch ? "Moderate" : "Off"}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": BING_API_KEY },
  });
  if (!res.ok) throw new Error(`Bing Error: ${res.statusText}`);
  const data = await res.json();
  return (
    data.webPages?.value?.map((item) => ({
      title: item.name,
      url: item.url,
      snippet: item.snippet,
      date: item.dateLastCrawled || null,
    })) || []
  );
}
