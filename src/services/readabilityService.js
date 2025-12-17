import { Platform } from "react-native";

class ReadabilityService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 15 * 60 * 1000; // 15 minutes
  }

  async extractContent(html, url) {
    try {
      const cacheKey = this.generateCacheKey(html, url);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.content;
      }

      const { load } = await import("cheerio");
      const $ = load(html);
      $("script, style, nav, footer, header, aside").remove();

      // Prefer main content containers if present
      let text = "";
      if ($("article").length) {
        text = $("article").text().replace(/\s+/g, " ").trim();
      } else if ($("main").length) {
        text = $("main").text().replace(/\s+/g, " ").trim();
      } else {
        text = $("body").text().replace(/\s+/g, " ").trim();
      }

      const wordCount = text.split(/\s+/).length;
      const metadata = {
        title: $("title").text().trim() || $("h1").first().text().trim(),
        byline:
          $("meta[name='author']").attr("content") ||
          $(".author").first().text().trim(),
        readingTime: Math.ceil(wordCount / 200),
        publishedTime: this.extractPublishedTime($),
        url,
      };

      const content = { text, metadata };
      this.cache.set(cacheKey, { content, timestamp: Date.now() });
      return content;
    } catch (error) {
      console.error("Error extracting content:", error);
      throw new Error(`Content extraction failed: ${error.message}`);
    }
  }

  async extractFromUrl(url) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": this.getUserAgent(),
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
        },
      });

      if (!response.ok) {
        throw new Error(
          `HTTP error ${response.status}: ${response.statusText}`,
        );
      }

      const html = await response.text();
      return await this.extractContent(html, url);
    } catch (error) {
      console.error("Failed to fetch URL:", error);
      throw new Error(`Failed to fetch URL: ${error.message}`);
    }
  }

  generateCacheKey(html, url) {
    let hash = 0;
    for (let i = 0; i < html.length; i++) {
      hash = (hash * 31 + html.charCodeAt(i)) >>> 0;
    }
    return `${url}_${hash}`;
  }

  normalizePublishedTime(value) {
    if (!value || typeof value !== "string") return "";
    const date = new Date(value.trim());
    if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
      return date.toISOString();
    }
    return "";
  }

  extractPublishedTime(source, document) {
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="pubdate"]',
      'meta[name="publishdate"]',
      'meta[name="date"]',
      'meta[name="dcterms.date"]',
      'meta[itemprop="datePublished"]',
      "time[datetime]",
    ];

    if (typeof source === "function") {
      const $ = source;
      for (const selector of selectors) {
        const element = $(selector).first();
        if (element && element.length) {
          const rawValue =
            element.attr("content") ||
            element.attr("datetime") ||
            element.text();
          const normalized = this.normalizePublishedTime(rawValue);
          if (normalized) return normalized;
        }
      }
      return "";
    }

    if (document && typeof document.querySelector === "function") {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const rawValue =
            element.getAttribute("content") ||
            element.getAttribute("datetime") ||
            element.textContent ||
            "";
          const normalized = this.normalizePublishedTime(rawValue);
          if (normalized) return normalized;
        }
      }
    }

    return "";
  }

  getUserAgent() {
    if (Platform.OS === "ios") {
      return "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";
    } else {
      return "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36";
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export default ReadabilityService;
