const mockPerformSearch = jest.fn();
const mockValidateSearchApiKeys = jest.fn();
const mockEnsureDirectoryExists = jest.fn();
const mockGetNodeFs = jest.fn();
const mockGetPathStats = jest.fn();
const mockGetReactNativeFs = jest.fn();
const mockIsDirectoryStat = jest.fn();
const mockListNodeDirectory = jest.fn();
const mockNormalizeDirectoryEntriesFromRN = jest.fn();
const mockPathExists = jest.fn();
const mockResolveSafePath = jest.fn();

jest.mock("../src/services/webSearchService", () => ({
  searchService: {
    performSearch: mockPerformSearch,
  },
}));

jest.mock("../src/services/utils/apiKeys", () => ({
  validate: mockValidateSearchApiKeys,
}));

jest.mock("../src/utils/fsUtils", () => ({
  ensureDirectoryExists: mockEnsureDirectoryExists,
  getNodeFs: mockGetNodeFs,
  getPathStats: mockGetPathStats,
  getReactNativeFs: mockGetReactNativeFs,
  isDirectoryStat: mockIsDirectoryStat,
  listNodeDirectory: mockListNodeDirectory,
  normalizeDirectoryEntriesFromRN: mockNormalizeDirectoryEntriesFromRN,
  pathExists: mockPathExists,
  resolveSafePath: mockResolveSafePath,
}));

beforeEach(() => {
  jest.resetModules();
  mockPerformSearch.mockReset();
  mockValidateSearchApiKeys.mockReset();
  mockEnsureDirectoryExists.mockReset();
  mockGetNodeFs.mockReset();
  mockGetPathStats.mockReset();
  mockGetReactNativeFs.mockReset();
  mockIsDirectoryStat.mockReset();
  mockListNodeDirectory.mockReset();
  mockNormalizeDirectoryEntriesFromRN.mockReset();
  mockPathExists.mockReset();
  mockResolveSafePath.mockReset();
});

describe("builtInTools.webSearch", () => {
  it("calls the search service and returns normalized results", async () => {
    mockGetReactNativeFs.mockReturnValue(null);
    mockValidateSearchApiKeys.mockResolvedValue(true);
    mockPerformSearch.mockResolvedValue([
      {
        title: "Alpha",
        url: "https://alpha.example",
        snippet: "Alpha snippet",
      },
      {
        name: "Beta",
        url: "https://beta.example",
        description: "Beta description",
      },
      {
        title: "",
        url: "",
        snippet: "",
      },
    ]);

    const { builtInTools } = require("../src/architecture/toolSystem");

    const result = await builtInTools.webSearch.execute(
      {
        query: "Hello world",
        provider: "Brave",
        maxResults: 4,
        safeSearch: false,
      },
      {
        originalParameters: { provider: "bing" },
        webSearch: { timeRange: "month" },
      },
    );

    expect(mockValidateSearchApiKeys).toHaveBeenCalledWith("brave");
    expect(mockPerformSearch).toHaveBeenCalledWith(
      "brave",
      "Hello world",
      4,
      "month",
      false,
    );
    expect(result).toEqual({
      success: true,
      provider: "brave",
      query: "Hello world",
      timeRange: "month",
      safeSearch: false,
      resultCount: 2,
      results: [
        {
          title: "Alpha",
          url: "https://alpha.example",
          snippet: "Alpha snippet",
        },
        {
          title: "Beta",
          url: "https://beta.example",
          snippet: "Beta description",
        },
      ],
    });
  });
});

describe("builtInTools.fileSystem", () => {
  it("reads files from the Node filesystem when the path is safe", async () => {
    const unicodeContent = "Hello 🌍";
    const expectedBytes = Buffer.byteLength(unicodeContent, "utf8");
    const readFile = jest.fn().mockResolvedValue(unicodeContent);
    mockGetNodeFs.mockReturnValue({ promises: { readFile } });
    mockGetReactNativeFs.mockReturnValue(null);
    mockResolveSafePath.mockReturnValue({
      absolutePath: "/safe/root/file.txt",
      isSafe: true,
      root: "/safe/root",
    });
    mockPathExists.mockResolvedValue(true);

    const { builtInTools } = require("../src/architecture/toolSystem");

    const result = await builtInTools.fileSystem.execute({
      operation: "read",
      path: "file.txt",
    });

    expect(mockResolveSafePath).toHaveBeenCalledWith("file.txt");
    expect(mockPathExists).toHaveBeenCalledWith("/safe/root/file.txt");
    expect(readFile).toHaveBeenCalledWith("/safe/root/file.txt", "utf8");
    expect(mockEnsureDirectoryExists).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      operation: "read",
      path: "/safe/root/file.txt",
      content: unicodeContent,
      bytesRead: expectedBytes,
    });
  });

  it("writes files with UTF-8 byte accounting", async () => {
    const unicodeContent = "A🌍B";
    const expectedBytes = Buffer.byteLength(unicodeContent, "utf8");
    const writeFile = jest.fn().mockResolvedValue(undefined);
    mockGetNodeFs.mockReturnValue({ promises: { writeFile } });
    mockGetReactNativeFs.mockReturnValue(null);
    mockResolveSafePath.mockReturnValue({
      absolutePath: "/safe/root/log.txt",
      isSafe: true,
      root: "/safe/root",
    });
    mockEnsureDirectoryExists.mockResolvedValue(undefined);

    const { builtInTools } = require("../src/architecture/toolSystem");

    const result = await builtInTools.fileSystem.execute({
      operation: "write",
      path: "log.txt",
      content: unicodeContent,
    });

    expect(mockResolveSafePath).toHaveBeenCalledWith("log.txt");
    expect(mockEnsureDirectoryExists).toHaveBeenCalledWith(
      "/safe/root/log.txt",
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/safe/root/log.txt",
      unicodeContent,
      "utf8",
    );
    expect(result).toEqual({
      success: true,
      operation: "write",
      path: "/safe/root/log.txt",
      bytesWritten: expectedBytes,
    });
  });

  it("rejects unsafe paths before performing operations", async () => {
    mockGetNodeFs.mockReturnValue({ promises: {} });
    mockGetReactNativeFs.mockReturnValue(null);
    mockResolveSafePath.mockReturnValue({
      absolutePath: "/safe/root/../etc/passwd",
      isSafe: false,
      root: "/safe/root",
    });

    const { builtInTools } = require("../src/architecture/toolSystem");

    const result = await builtInTools.fileSystem.execute({
      operation: "read",
      path: "../etc/passwd",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid path/);
    expect(mockPathExists).not.toHaveBeenCalled();
  });
});
