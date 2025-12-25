import registrySource from "../../../prompts/registry.json";

class PromptRegistry {
  constructor(opts = {}) {
    this.registry = opts.registry || registrySource;
    this._cache = null;
  }

  loadRegistry() {
    if (this._cache) return this._cache;
    const reg = this.registry;
    if (!reg || reg.schema_version !== 1 || !Array.isArray(reg.prompts)) {
      throw new Error(
        "Invalid prompt registry schema in prompts/registry.json",
      );
    }
    const index = new Map();
    for (const entry of reg.prompts) {
      if (!entry || !entry.id || !entry.version || !entry.file) continue;
      const key = `${entry.id}@${entry.version}`;
      index.set(key, entry);
    }
    this._cache = { raw: reg, index };
    return this._cache;
  }

  getPromptEntry(id, version) {
    const { index } = this.loadRegistry();
    const key = `${id}@${version}`;
    const entry = index.get(key);
    if (!entry) {
      throw new Error(`Prompt not found in registry: ${key}`);
    }
    return entry;
  }
}

export { PromptRegistry };
