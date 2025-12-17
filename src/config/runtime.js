const runtimeConfig = Object.create(null);

export function setRuntimeConfigValue(key, value) {
  runtimeConfig[key] = value;
}

export function getRuntimeConfigValue(key) {
  return runtimeConfig[key];
}

export function getRuntimeConfigSnapshot() {
  return { ...runtimeConfig };
}
