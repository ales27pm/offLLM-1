export function registerLLMPlugins(pluginManager, context) {
  pluginManager.registerPlugin("sparseAttention", {
    initialize: async () => console.log("Sparse attention plugin initialized"),
    replace: {
      generate: async function (prompt, maxTokens, temperature, options = {}) {
        const useSparseAttention =
          options.useSparseAttention ||
          context.deviceProfile.tier === "low" ||
          context.kvCache.size > context.kvCache.maxSize * 0.8;
        if (context.isWeb) {
          return context.generateWeb(prompt, maxTokens, temperature);
        }
        const generateOptions = {
          maxTokens,
          temperature,
          useSparseAttention,
        };
        return context.nativeModule.generate(prompt, generateOptions);
      },
    },
  });

  pluginManager.registerPlugin("adaptiveQuantization", {
    initialize: async () =>
      console.log("Adaptive quantization plugin initialized"),
    // The actual quantization adjustment logic now lives on the LLMService
    // instance. See src/services/llmService.js. No need to extend the global
    // LLMService prototype. Enabling this plugin simply allows
    // LLMService.scheduleQuantizationAdjustment to run.
  });
}



