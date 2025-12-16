export async function validateKey() {
  return true;
}

function parseResults(html, maxResults) {
  const results = [];
  const regex =
    /<a class="result__a".*?href="([^"]+)".*?>(.*?)<\/a>.*?<a class="result__snippet".*?>(.*?)<\/a>/gs;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < maxResults) {
    if (match[1].startsWith("//ad.")) continue;
    const url = match[1].startsWith("//") ? "https:" + match[1] : match[1];
    results.push({
      title: match[2].replace(/<[^>]*>/g, ""),
      url,
      snippet: match[3].replace(/<[^>]*>/g, ""),
      date: null,
    });
  }
  return results;
}

export async function search(query, { maxResults, safeSearch }) {
  const safe = safeSearch ? 1 : -1;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${maxResults * 2}&kp=${safe}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DuckDuckGo Error: ${res.statusText}`);
  const html = await res.text();
  return parseResults(html, maxResults);
}



