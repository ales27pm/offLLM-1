const isReactNative =
  typeof navigator !== "undefined" && navigator.product === "ReactNative";

let cachedRequire;

export const resolveNodeRequire = () => {
  if (cachedRequire !== undefined) {
    return cachedRequire;
  }

  let resolved = null;

  if (typeof globalThis === "object") {
    const nonWebpackRequire = globalThis.__non_webpack_require__;
    if (typeof nonWebpackRequire === "function") {
      resolved = nonWebpackRequire;
    }
  }

  if (
    !resolved &&
    typeof module !== "undefined" &&
    typeof module.require === "function"
  ) {
    resolved = module.require.bind(module);
  }

  if (!resolved && typeof require === "function") {
    resolved = require;
  }

  cachedRequire = resolved || null;
  return cachedRequire;
};

export const getGlobalProcess = () =>
  typeof process === "object" && process !== null ? process : null;

export { isReactNative };
