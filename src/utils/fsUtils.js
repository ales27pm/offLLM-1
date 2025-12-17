import {
  isReactNative,
  resolveNodeRequire,
  getGlobalProcess as _getGlobalProcess,
} from "./envUtils";
import {
  dirname,
  joinPath,
  normalizePath,
  getNodePath as _getNodePath,
} from "./pathUtils";

let RNFS = null;

if (isReactNative) {
  try {
    // react-native-fs is only available in React Native environments
    RNFS = require("react-native-fs");
  } catch (error) {
    console.warn(
      "[fsUtils] Failed to load react-native-fs; file system operations will be limited.",
      error,
    );
  }
}

let cachedNodeFs;
let nodeFsLoaded = false;
let cachedSafeRoot;

const getNodePath = () => _getNodePath();
const getGlobalProcess = () => _getGlobalProcess();

const computeDefaultSafeRoot = () => {
  if (!isReactNative) {
    const process = getGlobalProcess();
    if (process && typeof process === "object") {
      const envRoot =
        process.env && typeof process.env.OFFLLM_FS_ROOT === "string"
          ? process.env.OFFLLM_FS_ROOT
          : null;
      if (envRoot) {
        return normalizePath(envRoot);
      }
      if (typeof process.cwd === "function") {
        try {
          return normalizePath(process.cwd());
        } catch (error) {
          console.warn("[fsUtils] Failed to resolve process.cwd()", error);
        }
      }
    }
  }

  if (RNFS) {
    if (typeof RNFS.DocumentDirectoryPath === "string") {
      return normalizePath(RNFS.DocumentDirectoryPath);
    }
    if (typeof RNFS.TemporaryDirectoryPath === "string") {
      return normalizePath(RNFS.TemporaryDirectoryPath);
    }
  }

  return "";
};

export const getDefaultSafeRoot = () => {
  if (cachedSafeRoot === undefined) {
    cachedSafeRoot = computeDefaultSafeRoot();
  }
  return cachedSafeRoot;
};

const hasUnsafeTraversal = (targetPath) => {
  if (typeof targetPath !== "string") {
    return true;
  }
  const segments = targetPath.split(/[\\/]+/);
  let depth = 0;
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) {
        return true;
      }
      continue;
    }
    depth += 1;
  }
  return false;
};

const ensureTrailingSlash = (value) =>
  value.endsWith("/") ? value : `${value}/`;

const isAbsoluteWithinRoot = (absolutePath, rootPath) => {
  if (!rootPath) {
    return true;
  }

  const pathModule = getNodePath();
  if (pathModule) {
    const relative = pathModule.relative(rootPath, absolutePath);
    if (!relative || relative === ".") {
      return true;
    }
    return (
      !relative.startsWith("..") &&
      !relative.includes(`..${pathModule.sep}`) &&
      !pathModule.isAbsolute(relative)
    );
  }

  const normalisedAbsolute = normalizePath(absolutePath);
  const normalisedRoot = normalizePath(rootPath);
  if (!normalisedAbsolute || !normalisedRoot) {
    return false;
  }
  if (normalisedAbsolute === normalisedRoot) {
    return true;
  }
  const prefix = ensureTrailingSlash(normalisedRoot);
  return normalisedAbsolute.startsWith(prefix);
};

export const getReactNativeFs = () => RNFS;

export const getNodeFs = () => {
  if (!isReactNative) {
    if (!nodeFsLoaded) {
      nodeFsLoaded = true;
      const requireFn = resolveNodeRequire();
      if (requireFn) {
        try {
          cachedNodeFs = requireFn("fs");
        } catch (error) {
          console.warn(
            "[fsUtils] Failed to load Node fs module; file system operations will be limited.",
            error,
          );
          cachedNodeFs = null;
        }
      } else {
        cachedNodeFs = null;
      }
    }
    return cachedNodeFs;
  }
  return null;
};

const buildAbsolutePath = (targetPath, rootPath) => {
  const pathModule = getNodePath();
  if (pathModule) {
    if (rootPath) {
      return pathModule.resolve(rootPath, targetPath);
    }
    return pathModule.resolve(targetPath);
  }

  const normalisedTarget = normalizePath(targetPath);
  if (!rootPath) {
    return normalisedTarget;
  }

  const prefix = ensureTrailingSlash(rootPath);
  if (normalisedTarget.startsWith("/")) {
    return normalizePath(normalisedTarget);
  }
  return normalizePath(`${prefix}${normalisedTarget}`);
};

export const isPathSafe = (targetPath, options = {}) => {
  const { root = getDefaultSafeRoot() } = options;
  if (typeof targetPath !== "string" || targetPath.trim() === "") {
    return false;
  }
  if (hasUnsafeTraversal(targetPath)) {
    return false;
  }

  const normalisedRoot = root ? normalizePath(root) : "";
  const absolutePath = buildAbsolutePath(targetPath, normalisedRoot);
  return isAbsoluteWithinRoot(absolutePath, normalisedRoot);
};

export const resolveSafePath = (targetPath, options = {}) => {
  const { root = getDefaultSafeRoot() } = options;
  const rootPath = root ? normalizePath(root) : "";
  const absolutePath = buildAbsolutePath(targetPath ?? "", rootPath);
  const safe = isPathSafe(targetPath ?? "", { root: rootPath });
  return {
    absolutePath,
    isSafe: safe,
    root: rootPath || null,
  };
};

const asBoolean = (value) => value === true;

export const pathExists = async (path) => {
  const fs = getNodeFs();
  if (fs) {
    try {
      await fs.promises.access(path);
      return true;
    } catch {
      return false;
    }
  }

  if (RNFS) {
    try {
      const exists = await RNFS.exists(path);
      return asBoolean(exists);
    } catch {
      return false;
    }
  }

  return false;
};

export const getPathStats = async (path) => {
  const fs = getNodeFs();
  if (fs) {
    try {
      return await fs.promises.stat(path);
    } catch {
      return null;
    }
  }

  if (RNFS) {
    try {
      return await RNFS.stat(path);
    } catch {
      return null;
    }
  }

  return null;
};

export const isDirectoryStat = (stats) => {
  if (!stats) return false;
  if (stats.isDirectory && typeof stats.isDirectory === "function") {
    return stats.isDirectory();
  }
  if (typeof stats.isDirectory === "boolean") {
    return stats.isDirectory;
  }
  return false;
};

const isAlreadyExistsError = (error) => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = error.code;
  if (code === "EEXIST" || code === "ERR_FS_EEXIST") {
    return true;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return message.toLowerCase().includes("exist");
};

export const ensureDirectoryExists = async (path) => {
  const dir = dirname(path);
  if (!dir) {
    return;
  }

  const fs = getNodeFs();
  if (fs) {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
    return;
  }

  if (RNFS) {
    try {
      const exists = await RNFS.exists(dir);
      if (!asBoolean(exists)) {
        await RNFS.mkdir(dir);
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }
};

export const listNodeDirectory = async (path) => {
  const fs = getNodeFs();
  if (fs) {
    try {
      const entries = await fs.promises.readdir(path, { withFileTypes: true });
      return await Promise.all(
        entries.map(async (entry) => {
          const entryPath = joinPath(path, entry.name);
          let stats = null;
          try {
            stats = await fs.promises.stat(entryPath);
          } catch {
            stats = null;
          }
          return {
            name: entry.name,
            path: entryPath,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            size: stats ? stats.size : null,
            modifiedAt: stats ? stats.mtime : null,
          };
        }),
      );
    } catch (error) {
      console.warn("[fsUtils] Failed to read directory", path, error);
      return [];
    }
  }
  return [];
};

export const normalizeDirectoryEntriesFromRN = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    isDirectory:
      typeof entry.isDirectory === "function"
        ? entry.isDirectory()
        : !!entry.isDirectory,
    isFile:
      typeof entry.isFile === "function" ? entry.isFile() : !!entry.isFile,
    size: typeof entry.size === "number" ? entry.size : null,
    modifiedAt: entry.mtime || null,
  }));
};
