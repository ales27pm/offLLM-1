describe("device hardware detection", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEncryptionKey = process.env.MEMORY_ENCRYPTION_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEncryptionKey === undefined) {
      delete process.env.MEMORY_ENCRYPTION_KEY;
    } else {
      process.env.MEMORY_ENCRYPTION_KEY = originalEncryptionKey;
    }
    jest.resetModules();
  });

  test("uses node hardware probes when native metrics are unavailable", () => {
    jest.resetModules();
    process.env.NODE_ENV = "production";
    if (!process.env.MEMORY_ENCRYPTION_KEY) {
      process.env.MEMORY_ENCRYPTION_KEY = "test-key-123456789012";
    }

    const { getDeviceProfile } = require("../src/utils/deviceUtils");
    const profile = getDeviceProfile();

    expect(profile.processorCores).toBeGreaterThan(0);
    expect(profile.totalMemory).toBeGreaterThan(0);
    expect(profile.detectionMethod).not.toContain("fallback");
  });

  test("does not cache fallback profiles after transient native failures", () => {
    jest.resetModules();

    const runtimeStore = {};
    const setRuntimeConfigValue = jest.fn((key, value) => {
      runtimeStore[key] = value;
    });
    const getRuntimeConfigValue = jest.fn((key) => runtimeStore[key]);

    jest.doMock("../src/config/runtime", () => ({
      setRuntimeConfigValue,
      getRuntimeConfigValue,
    }));

    let probeAttempt = 0;
    const getTotalMemory = jest.fn(() => {
      if (probeAttempt === 0) {
        probeAttempt += 1;
        throw new Error("native module not ready");
      }
      return 8192;
    });

    jest.doMock("react-native", () => ({
      Platform: { OS: "ios" },
      NativeModules: {
        DeviceInfo: {
          getTotalMemory,
          getProcessorCount: jest.fn(() => 6),
        },
      },
    }));

    jest.isolateModules(() => {
      const { getDeviceProfile } = require("../src/utils/deviceUtils");

      const fallbackProfile = getDeviceProfile();
      expect(fallbackProfile.detectionMethod).toBe("fallback");
      expect(runtimeStore.deviceProfile).toBeUndefined();
      expect(setRuntimeConfigValue).not.toHaveBeenCalled();

      const resolvedProfile = getDeviceProfile();
      expect(resolvedProfile.totalMemory).toBe(8192);
      expect(resolvedProfile.processorCores).toBe(6);
      expect(resolvedProfile.detectionMethod).toBe("native");
      expect(runtimeStore.deviceProfile).toBe(resolvedProfile);
      expect(setRuntimeConfigValue).toHaveBeenCalledTimes(1);
    });
  });
});
