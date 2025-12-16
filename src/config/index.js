let Config = {};
const isReactNative =
  typeof navigator !== "undefined" && navigator.product === "ReactNative";
if (isReactNative) {
  try {
    Config = require("react-native-config");
  } catch (_e) {
    Config = {};
    console.warn(
      "[Config] Failed to load react-native-config. Falling back to empty config. This may indicate a misconfiguration.",
      _e,
    );
  }
}

export function getEnv(key) {
  if (Config && typeof Config[key] !== "undefined") {
    return Config[key];
  }
  if (
    typeof process !== "undefined" &&
    process.env &&
    typeof process.env[key] !== "undefined"
  ) {
    return process.env[key];
  }
  return undefined;
}



