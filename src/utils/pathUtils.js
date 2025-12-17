import { resolveNodeRequire } from "./envUtils";

let nodePathModule = null;
let nodePathLoaded = false;

const normalizeSeparators = (value) => value.replace(/\\+/g, "/");

const loadNodePathIfNeeded = () => {
  if (nodePathLoaded) {
    return;
  }
  nodePathLoaded = true;

  const requireFn = resolveNodeRequire();
  if (!requireFn) {
    nodePathModule = null;
    return;
  }

  try {
    nodePathModule = requireFn("path");
  } catch {
    nodePathModule = null;
  }
};

export const getNodePath = () => {
  loadNodePathIfNeeded();
  return nodePathModule;
};

export const dirname = (targetPath) => {
  if (!targetPath) {
    return "";
  }

  const pathModule = getNodePath();
  if (pathModule) {
    return pathModule.dirname(targetPath);
  }

  const normalised = normalizeSeparators(targetPath);
  const index = normalised.lastIndexOf("/");
  if (index <= 0) {
    return normalised.startsWith("/") ? "/" : "";
  }
  return normalised.slice(0, index);
};

export const joinPath = (base, segment) => {
  const pathModule = getNodePath();
  if (pathModule) {
    return pathModule.join(base, segment);
  }

  if (!base) {
    return segment;
  }

  const trimmed = normalizeSeparators(base).replace(/\/+$/, "");
  return `${trimmed}/${segment}`;
};

export const normalizePath = (targetPath) => {
  if (!targetPath) {
    return "";
  }

  const pathModule = getNodePath();
  if (pathModule) {
    return pathModule.normalize(targetPath);
  }

  const normalized = normalizeSeparators(targetPath);
  const isAbsolute = normalized.startsWith("/");
  const segments = normalized.split("/");
  const resolved = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        continue;
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  const prefix = isAbsolute ? "/" : "";
  return prefix + resolved.join("/");
};

export const resolvePath = (...segments) => {
  const pathModule = getNodePath();
  if (pathModule) {
    return pathModule.resolve(...segments);
  }

  const filtered = segments.filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (filtered.length === 0) {
    return "";
  }

  let resolvedPath = normalizeSeparators(filtered[0]);
  for (let index = 1; index < filtered.length; index += 1) {
    const segment = filtered[index];
    if (segment.startsWith("/")) {
      resolvedPath = normalizeSeparators(segment);
    } else {
      resolvedPath = joinPath(resolvedPath, segment);
    }
    resolvedPath = normalizePath(resolvedPath);
  }

  return normalizePath(resolvedPath);
};
