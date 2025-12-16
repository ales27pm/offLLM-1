export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.activePlugins = new Set();
    this.hooks = new Map();
    // Map of modulePath -> { orig, override? }
    this.modulePatches = new Map();
  }

  registerPlugin(name, plugin) {
    this.plugins.set(name, {
      ...plugin,
      enabled: false,
    });

    if (plugin.hooks) {
      for (const [hookName, hookFunction] of Object.entries(plugin.hooks)) {
        this.registerHook(hookName, hookFunction);
      }
    }
  }

  async enablePlugin(name) {
    if (!this.plugins.has(name)) {
      throw new Error(`Plugin ${name} not registered`);
    }

    const plugin = this.plugins.get(name);

    try {
      if (plugin.initialize) {
        await plugin.initialize();
      }

      if (plugin.replace) {
        for (const [target, implementation] of Object.entries(plugin.replace)) {
          // Only patch global/module functions when a module path is provided
          if (target.includes(".")) {
            this._replaceModuleFunction(target, implementation);
          }
        }
      }

      if (plugin.extend) {
        for (const [target, extensions] of Object.entries(plugin.extend)) {
          this._extendModule(target, extensions);
        }
      }

      plugin.enabled = true;
      this.activePlugins.add(name);

      console.log(`Plugin ${name} enabled successfully`);
    } catch (error) {
      console.error(`Failed to enable plugin ${name}:`, error);
      throw error;
    }
  }

  async disablePlugin(name) {
    if (!this.plugins.has(name) || !this.plugins.get(name).enabled) {
      return;
    }

    const plugin = this.plugins.get(name);

    try {
      if (plugin.cleanup) {
        await plugin.cleanup();
      }

      if (plugin.replace) {
        for (const [target] of Object.entries(plugin.replace)) {
          if (target.includes(".")) {
            this._restoreModuleFunction(target);
          }
        }
      }

      if (plugin.extend) {
        for (const [target, extensions] of Object.entries(plugin.extend)) {
          this._removeModuleExtensions(target, Object.keys(extensions));
        }
      }

      plugin.enabled = false;
      this.activePlugins.delete(name);

      console.log(`Plugin ${name} disabled successfully`);
    } catch (error) {
      console.error(`Failed to disable plugin ${name}:`, error);
    }
  }

  registerHook(hookName, hookFunction) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    this.hooks.get(hookName).push(hookFunction);
  }

  async executeHook(hookName, ...args) {
    if (!this.hooks.has(hookName)) {
      return;
    }

    const results = [];
    for (const hookFunction of this.hooks.get(hookName)) {
      try {
        results.push(await hookFunction(...args));
      } catch (error) {
        console.error(`Error executing hook ${hookName}:`, error);
      }
    }

    return results;
  }

  async execute(methodName, args, context) {
    await this.executeHook(`before_${methodName}`, ...args);

    let result;
    if (this.hasOverride(methodName)) {
      result = await this._executeOverride(methodName, args, context);
    } else {
      if (context[methodName]) {
        result = await context[methodName](...args);
      } else {
        throw new Error(`Method ${methodName} not found`);
      }
    }

    await this.executeHook(`after_${methodName}`, result, ...args);

    return result;
  }

  hasOverride(methodName) {
    for (const plugin of this.plugins.values()) {
      if (plugin.replace && plugin.replace[methodName]) {
        return true;
      }
    }
    return false;
  }

  isPluginEnabled(name) {
    return this.plugins.has(name) && this.plugins.get(name).enabled;
  }

  _replaceModuleFunction(modulePath, implementation) {
    const [moduleName, functionName] = modulePath.split(".");
    const module = global[moduleName];
    if (!module || !moduleName || !functionName) {
      console.warn(`Module path ${modulePath} not found for replacement`);
      return;
    }
    if (!this.modulePatches.has(modulePath)) {
      this.modulePatches.set(modulePath, { orig: module[functionName] });
    }
    const entry = this.modulePatches.get(modulePath);
    entry.override = implementation;
    module[functionName] = implementation;
  }

  getModuleFunction(modulePath) {
    const entry = this.modulePatches.get(modulePath);
    if (entry) {
      return entry.override || entry.orig;
    }
    const [moduleName, functionName] = modulePath.split(".");
    const module = global[moduleName];
    if (!module) return undefined;
    return module[functionName];
  }

  _restoreModuleFunction(modulePath) {
    const entry = this.modulePatches.get(modulePath);
    if (!entry) return;
    const [moduleName, functionName] = modulePath.split(".");
    const module = global[moduleName];
    if (module) {
      module[functionName] = entry.orig;
    }
    this.modulePatches.delete(modulePath);
  }

  _extendModule(moduleName, extensions) {
    if (!global[moduleName]) {
      global[moduleName] = {};
    }

    for (const [key, value] of Object.entries(extensions)) {
      const fullPath = `${moduleName}.${key}`;
      if (
        !this.modulePatches.has(fullPath) &&
        global[moduleName][key] !== undefined
      ) {
        this.modulePatches.set(fullPath, { orig: global[moduleName][key] });
      }
      global[moduleName][key] = value;
    }
  }

  _removeModuleExtensions(moduleName, keys) {
    for (const key of keys) {
      const fullPath = `${moduleName}.${key}`;
      const entry = this.modulePatches.get(fullPath);
      if (entry) {
        global[moduleName][key] = entry.orig;
        this.modulePatches.delete(fullPath);
      } else {
        delete global[moduleName][key];
      }
    }
  }

  _executeOverride(methodName, args, context) {
    for (const plugin of this.plugins.values()) {
      if (plugin.replace && plugin.replace[methodName]) {
        return plugin.replace[methodName].apply(context, args);
      }
    }

    throw new Error(`Override for ${methodName} not found`);
  }
}



