import { spawnSync } from "node:child_process";

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



