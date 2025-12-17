import { searchService } from "../services/webSearchService";
import { validate as validateApiKeys } from "../services/utils/apiKeys";

export const webSearchTool = {
  description: "Search the web for information using multiple providers",
  parameters: {
    query: {
      type: "string",
      required: true,
      description: "Search query",
    },
    maxResults: {
      type: "number",
      required: false,
      description: "Maximum number of results to return",
      default: 5,
      validate: (value) => value > 0 && value <= 20,
    },
    provider: {
      type: "string",
      required: false,
      description: "Search provider to use",
      enum: ["google", "bing", "duckduckgo", "brave"],
      default: "google",
    },
    timeRange: {
      type: "string",
      required: false,
      description: "Time range for results",
      enum: ["day", "week", "month", "year", "any"],
      default: "any",
    },
    safeSearch: {
      type: "boolean",
      required: false,
      description: "Enable safe search filtering",
      default: true,
    },
    extractContent: {
      type: "boolean",
      required: false,
      description: "Whether to extract readable content from search results",
      default: true,
    },
  },
  execute: async (parameters) => {
    const {
      query,
      maxResults = 5,
      provider = "google",
      timeRange = "any",
      safeSearch = true,
      extractContent = true,
    } = parameters;

    try {
      if (!(await validateApiKeys(provider))) {
        throw new Error(`API key not configured for ${provider} search`);
      }

      const results = await searchService.performSearchWithContentExtraction(
        provider,
        query,
        maxResults,
        timeRange,
        safeSearch,
        extractContent,
      );

      return {
        results: results.slice(0, maxResults),
        provider,
        query,
        success: true,
      };
    } catch (error) {
      console.error("Web search failed:", error);
      return {
        error: error.message,
        provider,
        query,
        success: false,
      };
    }
  },
};
