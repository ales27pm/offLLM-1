import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeText(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, "utf8");
}

export function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) {
    return {
      code: res.status ?? 1,
      stdout: res.stdout ?? "",
      stderr: res.stderr || res.error.message,
      error: res.error,
    };
  }
  return {
    code: res.status ?? 0,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

export function getValues(obj, ...pathKeys) {
  let cur = obj;
  for (const key of pathKeys) {
    cur = cur?.[key];
    if (!cur) return [];
  }
  return cur._values || [];
}



