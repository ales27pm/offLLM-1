import * as google from "./providers/google";
import * as bing from "./providers/bing";
import * as brave from "./providers/brave";
import * as duckduckgo from "./providers/duckduckgo";
import { validate } from "./utils/apiKeys";
import { simpleCache, rateLimiter } from "./utils/cacheAndRate";
import ReadabilityService from "./readabilityService";

const PROVIDERS = { google, bing, brave, duckduckgo };

export class SearchService {
  async performSearch(providerName, query, maxResults, timeRange, safeSearch) {
    const provider = PROVIDERS[providerName];
    if (!provider) throw new Error(`Unknown provider ${providerName}`);
    if (!(await validate(providerName))) {
      throw new Error(`No API key for ${providerName}`);
    }
    const run = () =>
      provider.search(query, { maxResults, timeRange, safeSearch });
    const limited = () => rateLimiter(providerName, run);
    return simpleCache(
      `${providerName}:${query}:${maxResults}:${timeRange}:${safeSearch}`,
      limited,
    );
  }

  async performSearchWithContentExtraction(
    provider,
    query,
    maxResults,
    timeRange,
    safeSearch,
    extractContent = true,
  ) {
    const results = await this.performSearch(
      provider,
      query,
      maxResults,
      timeRange,
      safeSearch,
    );
    if (!extractContent) return results;
    const readabilityService = new ReadabilityService();
    const enriched = [];
    for (const r of results) {
      try {
        // Use extractFromUrl instead of extract. The extract() method does not
        // exist on ReadabilityService; extractFromUrl fetches the page and
        // returns parsed content.
        const content = await readabilityService.extractFromUrl(r.url);
        enriched.push({
          ...r,
          content,
          contentExtracted: true,
        });
      } catch (e) {
        enriched.push({
          ...r,
          contentExtracted: false,
          contentExtractionError: e?.message || "Content extraction failed",
        });
      }
    }
    return enriched;
  }
}

export const searchService = new SearchService();



