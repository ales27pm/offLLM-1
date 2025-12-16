const ORIGINAL_TIMEOUT = 5000;

describe("cacheAndRate utilities", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    jest.setTimeout(250);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.setTimeout(ORIGINAL_TIMEOUT);
    jest.restoreAllMocks();
  });

  const loadModule = () => require("../src/services/utils/cacheAndRate");

  it("deduplicates concurrent cache calls and respects TTL", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { simpleCache, resetCacheAndRateState } = loadModule();

    const fn = jest
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const first = simpleCache("key", fn, 1000);
    const second = simpleCache("key", fn, 1000);

    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "first",
    ]);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(500);
    jest.setSystemTime(new Date("2024-01-01T00:00:00.500Z"));

    await expect(simpleCache("key", fn, 1000)).resolves.toBe("first");
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(600);
    jest.setSystemTime(new Date("2024-01-01T00:00:01.100Z"));

    await expect(simpleCache("key", fn, 1000)).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);

    resetCacheAndRateState();
  });

  it("validates TTL inputs before caching", async () => {
    const { simpleCache, resetCacheAndRateState } = loadModule();

    const fn = jest.fn().mockResolvedValue("ok");

    await expect(simpleCache("key", fn, Number.NaN)).rejects.toThrow(
      "simpleCache requires a finite TTL in milliseconds",
    );
    await expect(simpleCache("key", fn, -1)).rejects.toThrow(
      "simpleCache TTL must be non-negative",
    );

    expect(fn).not.toHaveBeenCalled();

    resetCacheAndRateState();
  });

  it("does not cache errors", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { simpleCache, resetCacheAndRateState } = loadModule();

    const error = new Error("boom");
    const fn = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("recovered");

    await expect(simpleCache("key", fn, 1000)).rejects.toBe(error);
    await expect(simpleCache("key", fn, 1000)).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);

    resetCacheAndRateState();
  });

  it("treats zero TTL as no post-resolution caching while still deduping in-flight calls", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { simpleCache, resetCacheAndRateState } = loadModule();

    const fn = jest
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const first = simpleCache("key", fn, 0);
    const second = simpleCache("key", fn, 0);

    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "first",
    ]);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    jest.setSystemTime(new Date("2024-01-01T00:00:00.001Z"));

    await expect(simpleCache("key", fn, 0)).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);

    resetCacheAndRateState();
  });

  it("rejects invalid delay values in the rate limiter", async () => {
    const { rateLimiter, resetCacheAndRateState } = loadModule();

    const fn = jest.fn().mockResolvedValue("ok");

    await expect(rateLimiter("provider", fn, Number.NaN)).rejects.toThrow(
      "rateLimiter requires a finite delay in milliseconds",
    );

    await expect(rateLimiter("provider", fn, -1)).rejects.toThrow(
      "rateLimiter delay must be non-negative",
    );

    expect(fn).not.toHaveBeenCalled();

    resetCacheAndRateState();
  });

  it("does not deduplicate errors for concurrent calls to simpleCache", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { simpleCache, resetCacheAndRateState } = loadModule();

    const fn = jest
      .fn()
      .mockImplementation(() => Promise.reject(new Error("boom")));

    const promise1 = simpleCache("key", fn, 1000).catch((error) => error);
    const promise2 = simpleCache("key", fn, 1000).catch((error) => error);

    const [err1, err2] = await Promise.all([promise1, promise2]);

    expect(err1).toBeInstanceOf(Error);
    expect(err2).toBeInstanceOf(Error);
    expect(err1).not.toBe(err2);
    expect(err1.message).toBe("boom");
    expect(err2.message).toBe("boom");
    expect(fn).toHaveBeenCalledTimes(2);

    resetCacheAndRateState();
  });

  it("propagates errors from delayed rate-limited executions and continues queueing", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { rateLimiter, resetCacheAndRateState } = loadModule();

    const successFn = jest.fn().mockResolvedValue("ok");
    const error = new Error("boom");
    const failingFn = jest.fn().mockRejectedValue(error);

    await rateLimiter("provider", successFn, 50);

    const pendingPromise = rateLimiter("provider", failingFn, 50);
    const expectation = expect(pendingPromise).rejects.toMatchObject({
      message: "boom",
    });

    await jest.advanceTimersByTimeAsync(50);
    await expectation;

    const afterError = rateLimiter("provider", successFn, 50);
    await jest.advanceTimersByTimeAsync(50);
    await expect(afterError).resolves.toBe("ok");

    expect(failingFn).toHaveBeenCalledTimes(1);
    expect(successFn).toHaveBeenCalledTimes(2);

    resetCacheAndRateState();
  });

  it("serialises bursts of rate limited calls", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { rateLimiter, resetCacheAndRateState } = loadModule();

    const invocationTimes = [];
    const fn = jest.fn().mockImplementation(() => {
      invocationTimes.push(Date.now());
      return Promise.resolve(invocationTimes.length);
    });

    const p1 = rateLimiter("provider", fn, 100);
    const p2 = rateLimiter("provider", fn, 100);
    const p3 = rateLimiter("provider", fn, 100);

    await jest.advanceTimersByTimeAsync(300);

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([1, 2, 3]);
    const deltas = invocationTimes.map((time, index) =>
      index === 0 ? 0 : time - invocationTimes[0],
    );
    expect(deltas).toEqual([0, 100, 200]);
    expect(fn).toHaveBeenCalledTimes(3);

    resetCacheAndRateState();
  });

  it("maintains separate rate limiting queues for each provider", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { rateLimiter, resetCacheAndRateState } = loadModule();

    const providerAInvocations = [];
    const providerBInvocations = [];

    const fnA = jest.fn().mockImplementation(() => {
      providerAInvocations.push(Date.now());
      return Promise.resolve(`A${providerAInvocations.length}`);
    });

    const fnB = jest.fn().mockImplementation(() => {
      providerBInvocations.push(Date.now());
      return Promise.resolve(`B${providerBInvocations.length}`);
    });

    const pA1 = rateLimiter("providerA", fnA, 100);
    const pA2 = rateLimiter("providerA", fnA, 100);
    const pA3 = rateLimiter("providerA", fnA, 100);

    const pB1 = rateLimiter("providerB", fnB, 100);
    const pB2 = rateLimiter("providerB", fnB, 100);
    const pB3 = rateLimiter("providerB", fnB, 100);

    await jest.advanceTimersByTimeAsync(300);

    await expect(Promise.all([pA1, pA2, pA3])).resolves.toEqual([
      "A1",
      "A2",
      "A3",
    ]);
    await expect(Promise.all([pB1, pB2, pB3])).resolves.toEqual([
      "B1",
      "B2",
      "B3",
    ]);

    const deltasA = providerAInvocations.map((time, index) =>
      index === 0 ? 0 : time - providerAInvocations[0],
    );
    const deltasB = providerBInvocations.map((time, index) =>
      index === 0 ? 0 : time - providerBInvocations[0],
    );

    expect(deltasA).toEqual([0, 100, 200]);
    expect(deltasB).toEqual([0, 100, 200]);
    expect(fnA).toHaveBeenCalledTimes(3);
    expect(fnB).toHaveBeenCalledTimes(3);

    resetCacheAndRateState();
  });
});
