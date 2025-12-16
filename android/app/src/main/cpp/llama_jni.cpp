#include "llama.h"
#include "mobile_quant.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <functional>
#include <jni.h>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

template <typename R>
R jniWithCtx(JNIEnv *env, jlong ctx_ptr, R defaultValue,
             std::function<R(LlamaContext *)> fn) {
  auto *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  if (!ctx)
    return defaultValue;
  try {
    return fn(ctx);
  } catch (const std::exception &e) {
    return defaultValue;
  }
}

struct JStringGuard {
  JNIEnv *env;
  jstring js;
  const char *cstr;
  JStringGuard(JNIEnv *e, jstring j)
      : env(e), js(j), cstr(env->GetStringUTFChars(j, 0)) {}
  ~JStringGuard() {
    if (cstr)
      env->ReleaseStringUTFChars(js, cstr);
  }
};

class LlamaContext {
public:
  LlamaContext(const std::string &model_path, int n_ctx, int n_threads,
               bool is_quantized) {
    std::lock_guard<std::mutex> lock(mutex_);

    llama_model_params model_params = llama_model_default_params();

    if (is_quantized) {
      model_params = apply_mobile_quant_optimizations(model_params);
      model_params.n_gpu_layers = 99;
    } else {
      model_params.n_gpu_layers = 35;
    }

#ifdef GGML_USE_FLASH_ATTN
    model_params.use_flash_attn = true;
#endif

    model_ = llama_load_model_from_file(model_path.c_str(), model_params);
    if (!model_) {
      throw std::runtime_error("Failed to load model");
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = n_ctx;
    ctx_params.n_threads = n_threads;
    ctx_params.n_threads_batch = n_threads;

    if (is_quantized && n_ctx > 4096) {
      ctx_params.use_sparse_attention = true;
    }

    ctx_ = llama_new_context_with_model(model_, ctx_params);
    if (!ctx_) {
      llama_free_model(model_);
      throw std::runtime_error("Failed to create context");
    }

    kv_cache_.reserve(max_cache_size_);
    is_quantized_ = is_quantized;
    performance_stats_ = {0, 0, 0};
  }

  ~LlamaContext() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (ctx_)
      llama_free(ctx_);
    if (model_)
      llama_free_model(model_);
  }

  std::vector<llama_token> tokenize(const std::string &text) {
    std::lock_guard<std::mutex> lock(mutex_);
    return llama_tokenize(ctx_, text, true);
  }

  std::string detokenize(const std::vector<llama_token> &tokens) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::string result;
    for (auto token : tokens) {
      result += llama_token_to_piece(ctx_, token);
    }
    return result;
  }

  std::vector<llama_token>
  generate(const std::vector<llama_token> &input_tokens, int max_tokens,
           float temperature, bool use_sparse_attention) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto start_time = std::chrono::high_resolution_clock::now();

    message_boundaries_.push_back(kv_cache_.size());

    kv_cache_.insert(kv_cache_.end(), input_tokens.begin(), input_tokens.end());

    trimCache();

    std::vector<llama_token> generated_tokens;
    generated_tokens.reserve(max_tokens);

    if (!kv_cache_.empty()) {
      llama_eval(ctx_, kv_cache_.data(), kv_cache_.size(), 0, 4);
    }

    for (int i = 0; i < max_tokens; i++) {
      llama_token next_token;

      if (use_sparse_attention) {
        next_token = llama_sample_token_sparse(ctx_, temperature);
      } else {
        next_token = llama_sample_token(ctx_, temperature);
      }

      if (next_token == llama_token_eos(ctx_)) {
        break;
      }

      generated_tokens.push_back(next_token);
      kv_cache_.push_back(next_token);

      trimCache();

      llama_eval(ctx_, &next_token, 1, kv_cache_.size() - 1, 4);
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        end_time - start_time);

    performance_stats_.total_inference_time += duration.count();
    performance_stats_.inference_count++;
    performance_stats_.last_inference_time = duration.count();

    return generated_tokens;
  }

  std::vector<float> embed(const std::string &text) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto tokens = tokenize(text);
    if (tokens.empty()) {
      return std::vector<float>(is_quantized_ ? 384 : 512, 0.0f);
    }

    std::vector<float> embedding(llama_n_embd(ctx_), 0.0f);
    llama_get_embeddings(ctx_, embedding.data());

    return embedding;
  }

  void clear_kv_cache() {
    std::lock_guard<std::mutex> lock(mutex_);
    kv_cache_.clear();
    message_boundaries_.clear();
  }

  void add_message_boundary() {
    std::lock_guard<std::mutex> lock(mutex_);
    message_boundaries_.push_back(kv_cache_.size());
  }

  size_t kv_cache_size() const { return kv_cache_.size(); }

  size_t kv_cache_max_size() const { return max_cache_size_; }

  PerformanceStats get_performance_stats() const { return performance_stats_; }

  void adjust_cache_size(size_t new_size) {
    std::lock_guard<std::mutex> lock(mutex_);
    max_cache_size_ = new_size;
    trimCache();
  }

  void enable_sparse_attention(bool enable) {
    std::lock_guard<std::mutex> lock(mutex_);
    use_sparse_attention_ = enable;
  }

private:
  llama_model *model_ = nullptr;
  llama_context *ctx_ = nullptr;
  std::vector<llama_token> kv_cache_;
  std::vector<size_t> message_boundaries_;
  size_t max_cache_size_ = 512;
  bool is_quantized_ = false;
  bool use_sparse_attention_ = false;
  mutable std::mutex mutex_;
  PerformanceStats performance_stats_;

  void trimCache() {
    if (kv_cache_.size() <= max_cache_size_)
      return;

    if (message_boundaries_.size() > 1) {
      size_t trim_index = 0;
      for (size_t i = 0; i < message_boundaries_.size() - 1; i++) {
        if (kv_cache_.size() - message_boundaries_[i] <= max_cache_size_) {
          trim_index = message_boundaries_[i];
          break;
        }
      }

      if (trim_index > 0) {
        kv_cache_.erase(kv_cache_.begin(), kv_cache_.begin() + trim_index);

        std::vector<size_t> new_boundaries;
        for (auto boundary : message_boundaries_) {
          if (boundary > trim_index) {
            new_boundaries.push_back(boundary - trim_index);
          }
        }
        message_boundaries_ = new_boundaries;
        return;
      }
    }

    size_t excess = kv_cache_.size() - max_cache_size_;
    kv_cache_.erase(kv_cache_.begin(), kv_cache_.begin() + excess);
  }
};

extern "C" JNIEXPORT jlong JNICALL
Java_com_mongars_LlamaTurboModule_loadModel(JNIEnv *env, jobject thiz,
                                                    jstring model_path,
                                                    jint context_size,
                                                    jint n_threads) {
  JStringGuard path(env, model_path);
  LlamaContext *ctx = nullptr;
  try {
    std::string model_path_str(path.cstr);
    bool is_quantized = false;
    std::vector<std::string> quant_patterns = {
        "Q4_0",   "Q5_0",   "Q2_K",   "Q3_K_S", "Q3_K_M", "Q3_K_L",
        "Q4_K_S", "Q4_K_M", "Q5_K_S", "Q5_K_M", "Q6_K",   "MobileQuant"};

    for (const auto &pattern : quant_patterns) {
      if (model_path_str.find(pattern) != std::string::npos) {
        is_quantized = true;
        break;
      }
    }

    int max_ctx = is_quantized ? 8192 : 4096;
    if (context_size <= 0 || context_size > max_ctx) {
      env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"),
                    "Invalid context size");
      return 0;
    }

    int hw_threads =
        std::max(1, static_cast<int>(std::thread::hardware_concurrency()));
    if (n_threads <= 0 || n_threads > hw_threads) {
      env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"),
                    "Invalid thread count");
      return 0;
    }

    ctx = new LlamaContext(path.cstr, context_size, n_threads, is_quantized);
    return reinterpret_cast<jlong>(ctx);
  } catch (const std::exception &e) {
    delete ctx;
    env->ThrowNew(env->FindClass("java/lang/RuntimeException"), e.what());
    return 0;
  }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_mongars_LlamaTurboModule_generate(
    JNIEnv *env, jobject thiz, jlong ctx_ptr, jstring prompt, jint max_tokens,
    jfloat temperature, jboolean use_sparse_attention) {
  return jniWithCtx<jstring>(
      env, ctx_ptr, env->NewStringUTF("Error: Model not loaded"),
      [&](LlamaContext *ctx) {
        JStringGuard g(env, prompt);
        std::string prompt_text(g.cstr);

        ctx->add_message_boundary();
        auto in = ctx->tokenize(prompt_text);
        auto out =
            ctx->generate(in, max_tokens, temperature, use_sparse_attention);

        in.insert(in.end(), out.begin(), out.end());
        std::string resp = ctx->detokenize(in);
        return env->NewStringUTF(resp.c_str());
      });
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_mongars_LlamaTurboModule_embed(JNIEnv *env, jobject thiz,
                                                jlong ctx_ptr, jstring text) {
  return jniWithCtx<jfloatArray>(
      env, ctx_ptr, env->NewFloatArray(0), [&](LlamaContext *ctx) {
        JStringGuard g(env, text);
        auto emb = ctx->embed(std::string(g.cstr));

        jfloatArray arr = env->NewFloatArray((jsize)emb.size());
        env->SetFloatArrayRegion(arr, 0, emb.size(), emb.data());
        return arr;
      });
}

extern "C" JNIEXPORT void JNICALL
Java_com_mongars_LlamaTurboModule_clearKVCache(JNIEnv *env,
                                                       jobject thiz,
                                                       jlong ctx_ptr) {
  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  if (ctx) {
    ctx->clear_kv_cache();
  }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_mongars_LlamaTurboModule_getKVCacheSize(JNIEnv *env,
                                                         jobject thiz,
                                                         jlong ctx_ptr) {
  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  if (ctx) {
    return ctx->kv_cache_size();
  }
  return 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_mongars_LlamaTurboModule_getKVCacheMaxSize(JNIEnv *env,
                                                            jobject thiz,
                                                            jlong ctx_ptr) {
  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  if (ctx) {
    return ctx->kv_cache_max_size();
  }
  return 512;
}

extern "C" JNIEXPORT void JNICALL
Java_com_mongars_LlamaTurboModule_addMessageBoundary(JNIEnv *env,
                                                             jobject thiz,
                                                             jlong ctx_ptr) {
  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  if (ctx) {
    ctx->add_message_boundary();
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_mongars_LlamaTurboModule_freeModel(JNIEnv *env, jobject thiz,
                                                    jlong ctx_ptr) {
  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  delete ctx;
}

extern "C" JNIEXPORT jobject JNICALL
Java_com_mongars_LlamaTurboModule_getPerformanceMetrics(JNIEnv *env,
                                                                jobject thiz,
                                                                jlong ctx_ptr) {
  if (ctx_ptr == 0) {
    return nullptr;
  }

  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);

  try {
    auto stats = ctx->get_performance_stats();

    jclass hashMapClass = env->FindClass("java/util/HashMap");
    jmethodID hashMapInit = env->GetMethodID(hashMapClass, "<init>", "()V");
    jobject hashMap = env->NewObject(hashMapClass, hashMapInit);
    jmethodID hashMapPut = env->GetMethodID(
        hashMapClass, "put",
        "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");

    env->CallObjectMethod(
        hashMap, hashMapPut, env->NewStringUTF("totalInferenceTime"),
        env->NewStringUTF(std::to_string(stats.total_inference_time).c_str()));
    env->CallObjectMethod(
        hashMap, hashMapPut, env->NewStringUTF("inferenceCount"),
        env->NewStringUTF(std::to_string(stats.inference_count).c_str()));
    env->CallObjectMethod(
        hashMap, hashMapPut, env->NewStringUTF("lastInferenceTime"),
        env->NewStringUTF(std::to_string(stats.last_inference_time).c_str()));

    return hashMap;
  } catch (const std::exception &e) {
    return nullptr;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_mongars_LlamaTurboModule_adjustPerformanceMode(JNIEnv *env,
                                                                jobject thiz,
                                                                jlong ctx_ptr,
                                                                jstring mode) {
  LlamaContext *ctx = reinterpret_cast<LlamaContext *>(ctx_ptr);
  if (!ctx) {
    return;
  }

  const char *mode_str = env->GetStringUTFChars(mode, 0);
  std::string mode_text(mode_str);
  env->ReleaseStringUTFChars(mode, mode_str);

  try {
    if (mode_text == "low-memory") {
      ctx->adjust_cache_size(256);
      ctx->enable_sparse_attention(true);
    } else if (mode_text == "power-saving") {
      ctx->adjust_cache_size(512);
      ctx->enable_sparse_attention(false);
    } else if (mode_text == "performance") {
      ctx->adjust_cache_size(1024);
      ctx->enable_sparse_attention(false);
    }
  } catch (const std::exception &e) {
    // Ignore errors
  }
}
