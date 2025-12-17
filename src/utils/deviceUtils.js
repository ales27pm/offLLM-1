import { Platform, NativeModules } from "react-native";
import {
  getRuntimeConfigValue,
  setRuntimeConfigValue,
} from "../config/runtime";

const DEVICE_PROFILE_KEY = "deviceProfile";

const fallbackWarningState = {
  memory: false,
  cores: false,
};

const isTestEnvironment =
  typeof process !== "undefined" && process.env?.NODE_ENV === "test";

function safeReadMetric(getter) {
  if (typeof getter !== "function") {
    return { value: undefined, error: undefined };
  }
  try {
    return { value: getter(), error: undefined };
  } catch (error) {
    return { value: undefined, error };
  }
}

function formatFallbackReason(...errors) {
  const reasons = errors
    .flat()
    .filter(Boolean)
    .map((error) => {
      if (typeof error === "string") {
        return error;
      }
      if (error && typeof error.message === "string") {
        return error.message;
      }
      return String(error);
    })
    .filter((reason) => typeof reason === "string" && reason.length > 0);
  if (reasons.length === 0) {
    return "";
  }
  return ` (${reasons.join("; ")})`;
}

function toPositiveInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.round(value));
}

function getNodeRequire() {
  if (typeof module !== "undefined" && typeof module.require === "function") {
    return module.require.bind(module);
  }
  try {
    // Using eval avoids bundlers (e.g. Metro) trying to resolve the module at build time.
    return eval("require");
  } catch {
    return null;
  }
}

function probeNodeHardware() {
  if (
    typeof process === "undefined" ||
    !process.release ||
    process.release.name !== "node"
  ) {
    return { totalMemory: undefined, processorCores: undefined };
  }

  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    return { totalMemory: undefined, processorCores: undefined };
  }

  try {
    const os = nodeRequire("os");
    const totalMemoryBytes =
      typeof os.totalmem === "function" ? os.totalmem() : undefined;
    const cpuInfo = typeof os.cpus === "function" ? os.cpus() : undefined;

    const totalMemory = toPositiveInteger(
      typeof totalMemoryBytes === "number"
        ? totalMemoryBytes / (1024 * 1024)
        : undefined,
    );
    const processorCores = Array.isArray(cpuInfo)
      ? toPositiveInteger(cpuInfo.length)
      : undefined;

    return { totalMemory, processorCores };
  } catch {
    return { totalMemory: undefined, processorCores: undefined };
  }
}

function deriveTier(totalMemory, processorCores) {
  if (totalMemory >= 6000 && processorCores >= 6) {
    return "high";
  }
  if (totalMemory >= 3000 && processorCores >= 4) {
    return "mid";
  }
  return "low";
}

function buildDeviceProfile() {
  const sources = new Set();

  let totalMemory;
  let processorCores;
  let usedFallbackForMemory = false;
  let usedFallbackForCores = false;
  let memoryProbeError;
  let coresProbeError;

  if (Platform.OS === "ios") {
    const memoryProbe = safeReadMetric(() =>
      NativeModules.DeviceInfo?.getTotalMemory?.(),
    );
    const nativeMemory = toPositiveInteger(memoryProbe.value);
    if (nativeMemory) {
      totalMemory = nativeMemory;
      sources.add("native");
      fallbackWarningState.memory = false;
    } else if (memoryProbe.error) {
      memoryProbeError = memoryProbe.error;
    }
    const coresProbe = safeReadMetric(() =>
      NativeModules.DeviceInfo?.getProcessorCount?.(),
    );
    const nativeCores = toPositiveInteger(coresProbe.value);
    if (nativeCores) {
      processorCores = nativeCores;
      sources.add("native");
      fallbackWarningState.cores = false;
    } else if (coresProbe.error) {
      coresProbeError = coresProbe.error;
    }
  } else {
    const memoryProbe = safeReadMetric(() =>
      NativeModules.DeviceInfo?.totalMemory?.(),
    );
    const nativeMemory = toPositiveInteger(memoryProbe.value);
    if (nativeMemory) {
      totalMemory = nativeMemory;
      sources.add("native");
      fallbackWarningState.memory = false;
    } else if (memoryProbe.error) {
      memoryProbeError = memoryProbe.error;
    }
    const coresProbe = safeReadMetric(() =>
      NativeModules.DeviceInfo?.processorCores?.(),
    );
    const nativeCores = toPositiveInteger(coresProbe.value);
    if (nativeCores) {
      processorCores = nativeCores;
      sources.add("native");
      fallbackWarningState.cores = false;
    } else if (coresProbe.error) {
      coresProbeError = coresProbe.error;
    }
  }

  if (memoryProbeError || coresProbeError) {
    if (!fallbackWarningState.memory || !fallbackWarningState.cores) {
      if (!isTestEnvironment) {
        console.warn(
          "[DeviceProfile] native hardware probes failed" +
            formatFallbackReason(memoryProbeError, coresProbeError) +
            ", returning fallback profile",
        );
      }
    }
    fallbackWarningState.memory = true;
    fallbackWarningState.cores = true;
    return {
      tier: "low",
      totalMemory: 2000,
      processorCores: 2,
      isLowEndDevice: true,
      platform: Platform.OS,
      isQuantized: true,
      detectionMethod: "fallback",
    };
  }

  if (!totalMemory || !processorCores) {
    const nodeHardware = probeNodeHardware();
    if (!totalMemory && nodeHardware.totalMemory) {
      totalMemory = nodeHardware.totalMemory;
      sources.add("node");
      fallbackWarningState.memory = false;
    }
    if (!processorCores && nodeHardware.processorCores) {
      processorCores = nodeHardware.processorCores;
      sources.add("node");
      fallbackWarningState.cores = false;
    }
  }

  if (!totalMemory) {
    if (!fallbackWarningState.memory) {
      if (!isTestEnvironment) {
        console.warn(
          "[DeviceProfile] hardware memory probe unavailable" +
            formatFallbackReason(memoryProbeError) +
            ", using fallback value 4000MB",
        );
      }
    }
    fallbackWarningState.memory = true;
    usedFallbackForMemory = true;
    totalMemory = 4000;
    sources.add("fallback");
  }
  if (!processorCores) {
    if (!fallbackWarningState.cores) {
      if (!isTestEnvironment) {
        console.warn(
          "[DeviceProfile] hardware core probe unavailable" +
            formatFallbackReason(coresProbeError) +
            ", using fallback value 4 cores",
        );
      }
    }
    fallbackWarningState.cores = true;
    usedFallbackForCores = true;
    processorCores = 4;
    sources.add("fallback");
  }

  const tier = deriveTier(totalMemory, processorCores);
  const detectionMethod =
    sources.size > 0 ? Array.from(sources).sort().join("+") : "unknown";

  const profile = {
    tier,
    totalMemory,
    processorCores,
    isLowEndDevice: tier === "low",
    platform: Platform.OS,
    isQuantized: totalMemory < 4000,
    detectionMethod,
  };

  if (!usedFallbackForMemory) {
    fallbackWarningState.memory = false;
  }

  if (!usedFallbackForCores) {
    fallbackWarningState.cores = false;
  }

  return profile;
}

function isFallbackProfile(profile) {
  if (!profile) {
    return false;
  }

  const detection = profile.detectionMethod;
  if (typeof detection !== "string") {
    return false;
  }

  return detection.split("+").includes("fallback");
}

export function getDeviceProfile(options = {}) {
  const { forceRefresh = false } = options ?? {};

  const cachedProfile = getRuntimeConfigValue(DEVICE_PROFILE_KEY);
  const hasValidCachedProfile =
    cachedProfile && !isFallbackProfile(cachedProfile);

  if (hasValidCachedProfile && !forceRefresh) {
    return cachedProfile;
  }

  if (cachedProfile && !hasValidCachedProfile) {
    setRuntimeConfigValue(DEVICE_PROFILE_KEY, undefined);
  }

  try {
    const profile = buildDeviceProfile();
    if (!isFallbackProfile(profile)) {
      setRuntimeConfigValue(DEVICE_PROFILE_KEY, profile);
    }
    return profile;
  } catch (error) {
    console.error("Failed to get device profile:", error);
    if (hasValidCachedProfile) {
      return cachedProfile;
    }
    const fallbackProfile = {
      tier: "low",
      totalMemory: 2000,
      processorCores: 2,
      isLowEndDevice: true,
      platform: Platform.OS,
      isQuantized: true,
      detectionMethod: "fallback",
    };
    return fallbackProfile;
  }
}

export function getPerformanceMode(
  deviceProfile,
  batteryLevel = 1.0,
  thermalState = "nominal",
) {
  const { tier, isLowEndDevice } = deviceProfile;

  // Base mode based on device tier
  let mode = "balanced";
  if (tier === "high") {
    mode = "performance";
  } else if (isLowEndDevice) {
    mode = "power-saving";
  }

  // Adjust based on battery level
  if (batteryLevel < 0.2) {
    mode = "power-saving";
  } else if (batteryLevel < 0.5 && mode === "performance") {
    mode = "balanced";
  }

  // Adjust based on thermal state
  if (thermalState === "serious" || thermalState === "critical") {
    mode = "power-saving";
  } else if (thermalState === "fair" && mode === "performance") {
    mode = "balanced";
  }

  return mode;
}

export function getRecommendedModelConfig(deviceProfile) {
  const { tier, isQuantized } = deviceProfile;

  if (tier === "high") {
    return {
      modelSize: "7B",
      quantization: isQuantized ? "Q4_K_M" : "none",
      contextSize: 8192,
      maxBatchSize: 8,
    };
  } else if (tier === "mid") {
    return {
      modelSize: "3B",
      quantization: "Q4_K_S",
      contextSize: 4096,
      maxBatchSize: 4,
    };
  } else {
    return {
      modelSize: "1B",
      quantization: "Q4_0",
      contextSize: 2048,
      maxBatchSize: 2,
    };
  }
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);

  return (
    parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + " " + sizes[index]
  );
}

export function formatMilliseconds(ms, decimals = 1) {
  if (ms < 0) {
    return "Invalid duration";
  }
  if (ms < 1000) {
    return ms.toFixed(decimals) + "ms";
  } else if (ms < 60000) {
    return (ms / 1000).toFixed(decimals) + "s";
  } else {
    return (ms / 60000).toFixed(decimals) + "min";
  }
}

export function isDeviceCompatible(minRequirements = {}) {
  const {
    minMemory = 2000,
    minProcessorCores = 2,
    platforms = ["ios", "android"],
  } = minRequirements;

  const deviceProfile = getDeviceProfile();

  return (
    deviceProfile.totalMemory >= minMemory &&
    deviceProfile.processorCores >= minProcessorCores &&
    platforms.includes(deviceProfile.platform)
  );
}
