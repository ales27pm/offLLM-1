describe("logger", () => {
  let logger: typeof import("../src/utils/logger").default;
  let LogLevel: typeof import("../src/utils/logger").LogLevel;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    ({ logger, LogLevel } = require("../src/utils/logger"));
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("respects configured log level", () => {
    logger.setLogLevel(LogLevel.INFO);
    logger.debug("Test", "hidden");
    const entries = logger.getLogs();
    expect(
      entries.some(
        (entry) => entry.tag === "Test" && entry.level === LogLevel.DEBUG,
      ),
    ).toBe(false);
  });

  it("clears logs without adding a new entry", () => {
    logger.info("Test", "message");
    expect(logger.getLogs()).toHaveLength(1);
    logger.clearLogs();
    expect(logger.getLogs()).toHaveLength(0);
  });

  it("maintains only the most recent entries up to the cap", () => {
    for (let index = 0; index < 1100; index += 1) {
      logger.info("Ring", `message-${index}`);
    }
    const ringEntries = logger
      .getLogs()
      .filter((entry) => entry.tag === "Ring");
    expect(ringEntries.length).toBe(1000);
    expect(ringEntries[0].message).toBe("message-100");
    expect(ringEntries[ringEntries.length - 1].message).toBe("message-1099");
  });

  it("persists logs when file logging is enabled", async () => {
    const fileSystem = require("expo-file-system");
    logger.setFileLoggingEnabled(true);
    logger.error("Network", "Request failed");
    await new Promise((resolve) => setImmediate(resolve));
    expect(fileSystem.__files.size).toBeGreaterThan(0);
  });
});
