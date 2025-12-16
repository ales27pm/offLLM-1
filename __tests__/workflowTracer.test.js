describe("WorkflowTracer", () => {
  let WorkflowTracer;
  let loggerModule;
  let logger;
  let LogLevel;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    loggerModule = require("../src/utils/logger");
    ({ logger, LogLevel } = loggerModule);
    ({ WorkflowTracer } = require("../src/core/workflows/WorkflowTracer"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records lifecycle information for successful steps", async () => {
    const tracer = new WorkflowTracer({ workflowName: "TestFlow" });
    await tracer.withStep("demo", async () => "ok", {
      startData: { note: "begin" },
      successData: (value) => ({ value }),
    });
    tracer.finish({ summary: true });

    const logs = logger.getLogs();
    expect(
      logs.some(
        (entry) =>
          entry.level === LogLevel.INFO && entry.message.includes("demo"),
      ),
    ).toBe(true);
    expect(
      logs.some((entry) => entry.message.includes("Workflow completed")),
    ).toBe(true);
  });

  it("logs failures and rethrows errors", async () => {
    const tracer = new WorkflowTracer({ workflowName: "TestFlow" });
    await expect(
      tracer.withStep("willFail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const errorLogs = logger.getLogs(LogLevel.ERROR);
    expect(errorLogs.some((entry) => entry.message.includes("willFail"))).toBe(
      true,
    );
  });
});
