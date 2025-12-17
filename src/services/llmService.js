import { NativeModules, Platform } from "react-native";
import LLM from "../specs/NativeLLM";
import { getDeviceProfile } from "../utils/deviceUtils";
import { PluginManager } from "../architecture/pluginManager";
import { DependencyInjector } from "../architecture/dependencyInjector";
import { registerLLMPlugins } from "../architecture/pluginSetup";
import { setupLLMDI } from "../architecture/diSetup";
import { ensureModelDownloaded } from "../utils/modelDownloader";
import { MODEL_CONFIG } from "../config/model";

class Mutex {
  constructor() {
    this._locking = Promise.resolve();
    this._locked = false;
  }
  async runExclusive(callback) {
    let release;
    const nextLock = new Promise((resolve) => (release = resolve));
    const currentLock = this._locking;
    this._locking = this._locking.then(() => nextLock);
    await currentLock;
    this._locked = true;
    try {
      return await callback();
    } finally {
      this._locked = false;
      release();
    }
  }
}

class LLMService {
  #loadMutex = new Mutex();

  constructor() {
    this.isWeb = Platform.OS === "web";
    this.isReady = false;
    this.modelPath = null;
    this.kvCache = { tokens: [], size: 0, maxSize: 512 };
    this.pluginManager = new PluginManager();
    this.dependencyInjector = new DependencyInjector();

    if (!this.isWeb) {
      const legacy = NativeModules.MLXModule || NativeModules.LlamaTurboModule;
      this.nativeModule = LLM ?? legacy;
    }

    this.deviceProfile = getDeviceProfile();
    this.performanceMetrics = {
      totalInferenceTime: 0,
      inferenceCount: 0,
      averageInferenceTime: 0,
      lastLatency: 0,
    };

    registerLLMPlugins(this.pluginManager, this);
    setupLLMDI(this.dependencyInjector, this);
  }

  async _nativeLoad(path, options) {
    if (this.nativeModule.loadModel)
      return this.nativeModule.loadModel(path, options);
    if (this.nativeModule.load) return this.nativeModule.load(path);
    throw new Error("Native module incompatible");
  }

  async loadConfiguredModel() {
    if (this.isWeb || this.isReady) return true;
    return await this.loadModel(null);
  }

  async loadModel(customPath) {
    return await this.#loadMutex.runExclusive(async () => {
      try {
        const path =
          customPath ||
          (await ensureModelDownloaded(MODEL_CONFIG.url, {
            checksum: MODEL_CONFIG.checksum,
          }));
        console.log(`[LLMService] Loading: ${path}`);
        const isModelId =
          typeof customPath === "string" &&
          !customPath.startsWith("/") &&
          !customPath.startsWith("file://") &&
          !/^[a-z]+:\/\//i.test(customPath);

        let result;
        if (this.isWeb) {
          // We don't have web inference yet, throwing to be safe
          throw new Error("Web inference not configured.");
        } else {
          if (this.isReady && this.nativeModule.unload)
            await this.nativeModule.unload();

          const options = {
            ...(Platform.OS === "android" ? { contextSize: 4096 } : {}),
            ...(isModelId ? { modelId: customPath } : {}),
          };
          const loadOptions = Object.keys(options).length > 0 ? options : null;
          result = await this._nativeLoad(path, loadOptions);

          await this.pluginManager.enablePlugin("sparseAttention");
        }

        this.isReady = true;
        this.modelPath = path;
        await this.clearKVCache();
        return result;
      } catch (error) {
        console.error("Failed to load model:", error);
        this.isReady = false;
        throw error;
      }
    });
  }

  async generate(prompt, maxTokens = 256, temperature = 0.7, options = {}) {
    if (!this.isWeb && !this.isReady) await this.loadConfiguredModel();

    const adaptiveTemp =
      this.performanceMetrics.lastLatency > 2000 ? 0.2 : temperature;
    const start = Date.now();

    try {
      let response;
      const genOptions = { maxTokens, temperature: adaptiveTemp, ...options };

      if (this.pluginManager.isPluginEnabled("sparseAttention")) {
        response = await this.pluginManager.execute(
          "generate",
          [prompt, maxTokens, adaptiveTemp, options],
          this,
        );
      } else {
        if (this.isWeb) {
          throw new Error("Web inference not configured.");
        } else {
          response = await this.nativeModule.generate(prompt, genOptions);
        }
      }

      if (typeof response === "string") response = { text: response };

      this._updateMetrics(Date.now() - start);

      return {
        ...response,
        inferenceTime: this.performanceMetrics.lastLatency,
      };
    } catch (error) {
      console.error("Generation failed:", error);
      throw error;
    }
  }

  _updateMetrics(duration) {
    this.performanceMetrics.lastLatency = duration;
    this.performanceMetrics.totalInferenceTime += duration;
    this.performanceMetrics.inferenceCount++;
    this.performanceMetrics.averageInferenceTime =
      this.performanceMetrics.totalInferenceTime /
      this.performanceMetrics.inferenceCount;
  }

  async clearKVCache() {
    try {
      if (!this.isWeb && this.nativeModule?.clearKVCache)
        await this.nativeModule.clearKVCache();
      this.kvCache = { tokens: [], size: 0, maxSize: 512 };
      return true;
    } catch (error) {
      console.error("Failed to clear KV cache", error);
      return false;
    }
  }

  async embed(text) {
    if (!this.isReady && !this.isWeb) throw new Error("Model not loaded");
    if (this.isWeb) throw new Error("Web embedding not supported");
    return await this.nativeModule.embed(text);
  }
}

export default new LLMService();
