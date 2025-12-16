import Foundation
import Darwin
import os
import React
@preconcurrency import MLX
@preconcurrency import MLXLLM
@preconcurrency import MLXLMCommon

#if canImport(AppSpec)
import AppSpec
public typealias LLMSpec = NativeLLMSpec
#elseif canImport(AppSpecs)
import AppSpecs
public typealias LLMSpec = NativeLLMSpec
#else
// The Objective-C++ shim in `LLM+Turbo.mm` declares the concrete module's
// `RCTTurboModule` conformance. Keeping the Swift fallback tied to
// `NSObjectProtocol` avoids importing ReactCommon—which pulls heavy C++
// headers Swift cannot parse in our build settings—while still exposing the
// promise-based surface expected by React Native when codegen specs are
// unavailable.
@objc public protocol LLMSpec: NSObjectProtocol {
  func loadModel(_ path: String,
                 options: [AnyHashable: Any]?,
                 resolve: @escaping RCTPromiseResolveBlock,
                 reject: @escaping RCTPromiseRejectBlock)
  func unloadModel(_ resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock)
  func generate(_ prompt: String,
                options: [AnyHashable: Any]?,
                resolve: @escaping RCTPromiseResolveBlock,
                reject: @escaping RCTPromiseRejectBlock)
  func embed(_ text: String,
             resolve: @escaping RCTPromiseResolveBlock,
             reject: @escaping RCTPromiseRejectBlock)
  func getPerformanceMetrics(_ resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock)
  func getKVCacheSize(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock)
  func getKVCacheMaxSize(_ resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock)
  func clearKVCache(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock)
  func addMessageBoundary(_ resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock)
  func adjustPerformanceMode(_ mode: String,
                             resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock)
}
#endif

// React types are exposed via the bridging header; no explicit import is required.

private enum NativeLLMError: LocalizedError {
  case modelNotLoaded
  case modelNotFound
  case embeddingUnavailable(String)

  var errorDescription: String? {
    switch self {
    case .modelNotLoaded:
      return "No model has been loaded"
    case .modelNotFound:
      return "Unable to locate a compatible model configuration"
    case .embeddingUnavailable(let reason):
      return "Embedding unavailable: \(reason)"
    }
  }

  var code: String {
    switch self {
    case .modelNotLoaded:
      return "NO_MODEL"
    case .modelNotFound:
      return "ENOENT"
    case .embeddingUnavailable:
      return "EMBED_UNAVAILABLE"
    }
  }
}

private struct LoadDetails: Sendable {
  let identifier: String
  let contextLength: Int?
}

private struct GenerationSummary: Sendable {
  let text: String
  let promptTokens: Int
  let generatedTokens: Int
  let duration: TimeInterval
  let kvCacheSize: Int
  let kvCacheMax: Int?
  let toolCalls: [ToolCallSummary]
}

private struct ToolCallSummary: Sendable {
  let name: String
  let arguments: [String: JSONValue]

  func asDictionary() -> [String: Any] {
    var payload: [String: Any] = ["name": name]
    payload["arguments"] = arguments.mapValues { $0.foundationValue }
    return payload
  }
}

private enum JSONValue: Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case array([JSONValue])
  case object([String: JSONValue])
  case null

  init(from value: Any) {
    if let string = value as? String {
      self = .string(string)
    } else if let bool = value as? Bool {
      self = .bool(bool)
    } else if let number = value as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        self = .bool(number.boolValue)
      } else {
        self = .number(number.doubleValue)
      }
    } else if let double = value as? Double {
      self = .number(double)
    } else if let float = value as? Float {
      self = .number(Double(float))
    } else if let int = value as? Int {
      self = .number(Double(int))
    } else if let array = value as? [Any] {
      self = .array(array.map { JSONValue(from: $0) })
    } else if let dictionary = value as? [String: Any] {
      var mapped: [String: JSONValue] = [:]
      mapped.reserveCapacity(dictionary.count)
      for (key, nestedValue) in dictionary {
        mapped[key] = JSONValue(from: nestedValue)
      }
      self = .object(mapped)
    } else if value is NSNull {
      self = .null
    } else {
      self = .string(String(describing: value))
    }
  }

  var foundationValue: Any {
    switch self {
    case .string(let value):
      return value
    case .number(let value):
      return value
    case .bool(let value):
      return value
    case .array(let values):
      return values.map { $0.foundationValue }
    case .object(let object):
      var dictionary: [String: Any] = [:]
      dictionary.reserveCapacity(object.count)
      for (key, value) in object {
        dictionary[key] = value.foundationValue
      }
      return dictionary
    case .null:
      return NSNull()
    }
  }
}

private struct GenerationOutput: Sendable {
  let text: String
  let completion: GenerateCompletionInfo?
  let toolCalls: [ToolCallSummary]
}

private final class CacheBox: @unchecked Sendable {
  var value: [KVCache]

  init(value: [KVCache]) {
    self.value = value
  }
}

extension GenerateCompletionInfo: @unchecked Sendable {}

private actor NativeLLMRuntime {
  private let fallbackModelIDs: [String]
  private var container: ModelContainer?
  private var configuration: ModelConfiguration?
  private var conversation: [Chat.Message] = []
  private var cache: [KVCache] = []
  private var messageBoundaries: [Int] = []
  private var currentMaxKV: Int?
  private var lastCompletion: GenerateCompletionInfo?

  init(fallbackModelIDs: [String]) {
    self.fallbackModelIDs = fallbackModelIDs
  }

  var isLoaded: Bool { container != nil }

  // Overloads that accept Sendable JSON options to avoid crossing actor boundary with [String: Any].
  func loadModel(path: String?, options: [String: JSONValue]) async throws -> LoadDetails {
    let foundation = options.reduce(into: [String: Any]()) { $0[$1.key] = $1.value.foundationValue }
    return try await loadModel(path: path, options: foundation)
  }

  func generate(prompt: String,
                options: [String: JSONValue],
                onChunk: (@Sendable (String) -> Void)?) async throws -> GenerationSummary {
    let foundation = options.reduce(into: [String: Any]()) { $0[$1.key] = $1.value.foundationValue }
    return try await generate(prompt: prompt, options: foundation, onChunk: onChunk)
  }


  func loadModel(path: String?, options: [String: Any]) async throws -> LoadDetails {
    let candidates = configurations(for: path, options: options)
    guard !candidates.isEmpty else { throw NativeLLMError.modelNotFound }

    var lastError: Error?
    for configuration in candidates {
      do {
        let container = try await LLMModelFactory.shared.loadContainer(configuration: configuration)
        self.container = container
        self.configuration = configuration
        conversation.removeAll()
        cache.removeAll()
        messageBoundaries.removeAll()
        lastCompletion = nil

        let requestedContext = options["contextLength"] as? NSNumber
        let defaultContext = requestedContext.map { Int(truncating: $0) }
        self.currentMaxKV = defaultContext ?? self.currentMaxKV ?? 4096

        return LoadDetails(identifier: configuration.name, contextLength: currentMaxKV)
      } catch {
        lastError = error
      }
    }

    throw lastError ?? NativeLLMError.modelNotFound
  }

  func unload() {
    container = nil
    configuration = nil
    conversation.removeAll()
    cache.removeAll()
    messageBoundaries.removeAll()
    lastCompletion = nil
  }

  func clearCache() {
    cache.removeAll()
    conversation.removeAll()
    messageBoundaries.removeAll()
    lastCompletion = nil
  }

  func setMaxKVCache(_ value: Int?) {
    currentMaxKV = value
    cache.removeAll()
  }

  func addBoundary() {
    messageBoundaries.append(conversation.count)
    if messageBoundaries.count > 8 {
      messageBoundaries.removeFirst(messageBoundaries.count - 8)
    }
  }

  func kvCacheSize() -> Int {
    cache.first?.offset ?? 0
  }

  func kvCacheMaxSize() -> Int {
    currentMaxKV ?? 0
  }

  func latestCompletion() -> GenerateCompletionInfo? {
    lastCompletion
  }

  func generate(prompt: String,
                options: [String: Any],
                onChunk: (@Sendable (String) -> Void)?) async throws -> GenerationSummary {
    guard let container else { throw NativeLLMError.modelNotLoaded }

    var parameters = parameters(from: options)
    parameters.maxKVSize = currentMaxKV
    let generationParameters = parameters
    let messages = conversation + [.user(prompt)]
    let cacheBox = CacheBox(value: cache)

    let result = try await container.perform { context -> GenerationOutput in
      let userInput = UserInput(chat: messages)
      let input = try await context.processor.prepare(input: userInput)

      if cacheBox.value.isEmpty {
        cacheBox.value = context.model.newCache(parameters: generationParameters)
      }

      let stream = try MLXLMCommon.generate(input: input,
                                            cache: cacheBox.value,
                                            parameters: generationParameters,
                                            context: context)

      var collectedText = ""
      var completionInfo: GenerateCompletionInfo?
      var collectedToolCalls: [ToolCallSummary] = []

      for await event in stream {
        if let chunk = event.chunk, !chunk.isEmpty {
          collectedText.append(chunk)
          onChunk?(chunk)
        }
        if let info = event.info {
          completionInfo = info
        }
        if let call = event.toolCall {
          var arguments: [String: JSONValue] = [:]
          for (key, value) in call.function.arguments {
            arguments[key] = JSONValue(from: value.anyValue)
          }
          collectedToolCalls.append(ToolCallSummary(name: call.function.name, arguments: arguments))
        }
      }

      return GenerationOutput(text: collectedText,
                              completion: completionInfo,
                              toolCalls: collectedToolCalls)
    }

    cache = cacheBox.value
    conversation = messages + [.assistant(result.text)]
    pruneConversationIfNeeded()
    lastCompletion = result.completion

    let summary = GenerationSummary(
      text: result.text,
      promptTokens: result.completion?.promptTokenCount ?? 0,
      generatedTokens: result.completion?.generationTokenCount ?? 0,
      duration: (result.completion?.promptTime ?? 0) + (result.completion?.generateTime ?? 0),
      kvCacheSize: cache.first?.offset ?? 0,
      kvCacheMax: currentMaxKV,
      toolCalls: result.toolCalls
    )

    return summary
  }

  func embedding(for text: String) async throws -> [Double] {
    guard let container else { throw NativeLLMError.modelNotLoaded }

    return try await container.perform { context -> [Double] in
      let userInput = UserInput(chat: [.user(text)])
      let input = try await context.processor.prepare(input: userInput)

      let caches = context.model.newCache(parameters: nil)
      let prepared = try context.model.prepare(input, cache: caches, windowSize: nil)

      let output: LMOutput
      switch prepared {
      case .logits(let logits):
        output = logits
      case .tokens(let tokens):
        output = context.model(tokens, cache: caches, state: nil)
      }

      var logits = output.logits
      if logits.ndim >= 2 {
        logits = logits[0, -1, 0...]
      }

      let evaluated = logits.asType(.float32)
      let values = evaluated.asArray(Float.self)
      return values.map { Double($0) }
    }
  }

  private func configurations(for path: String?, options: [String: Any]) -> [ModelConfiguration] {
    var results: [ModelConfiguration] = []
    var seen: Set<String> = []

    func append(_ configuration: ModelConfiguration) {
      let key: String
      switch configuration.id {
      case .id(let id, let revision):
        key = "id:\(id)#\(String(describing: revision))"
      case .directory(let url):
        key = "dir:\(url.path)"
      }
      if seen.insert(key).inserted {
        results.append(configuration)
      }
    }

    func appendIdentifier(_ identifier: String?) {
      guard let identifier else { return }
      let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return }
      if let bundled = BundledModelLocator.directory(for: trimmed) {
        append(ModelConfiguration(directory: bundled))
      }
      append(ModelConfiguration(id: trimmed))
    }

    appendIdentifier(options["modelId"] as? String)

    if let rawPath = path?.trimmingCharacters(in: .whitespacesAndNewlines), !rawPath.isEmpty {
      var isDirectory: ObjCBool = false
      if FileManager.default.fileExists(atPath: rawPath, isDirectory: &isDirectory) {
        if isDirectory.boolValue {
          append(ModelConfiguration(directory: URL(fileURLWithPath: rawPath)))
        } else {
          let parent = URL(fileURLWithPath: rawPath).deletingLastPathComponent()
          if FileManager.default.fileExists(atPath: parent.path, isDirectory: &isDirectory),
             isDirectory.boolValue {
            append(ModelConfiguration(directory: parent))
          }
        }
      }

      if rawPath.contains("/") && !rawPath.hasPrefix("/") {
        appendIdentifier(rawPath)
      }
    }

    for fallback in fallbackModelIDs {
      appendIdentifier(fallback)
    }

    return results
  }

  private func parameters(from options: [String: Any]) -> GenerateParameters {
    var parameters = GenerateParameters()

    if let maxTokens = options["maxTokens"] as? NSNumber {
      parameters.maxTokens = max(0, Int(truncating: maxTokens))
    }

    if let temperature = options["temperature"] as? NSNumber {
      parameters.temperature = Float(truncating: temperature)
    }

    if let topP = options["topP"] as? NSNumber {
      parameters.topP = min(max(Float(truncating: topP), 0.01), 1.0)
    } else if let topK = options["topK"] as? NSNumber {
      parameters.topP = topPValue(for: Int(truncating: topK))
    }

    if let kvBits = options["kvBits"] as? NSNumber {
      parameters.kvBits = Int(truncating: kvBits)
    }

    if let kvGroupSize = options["kvGroupSize"] as? NSNumber {
      parameters.kvGroupSize = Int(truncating: kvGroupSize)
    }

    if let kvStart = options["quantizedKVStart"] as? NSNumber {
      parameters.quantizedKVStart = Int(truncating: kvStart)
    }

    if let repetitionPenalty = options["repetitionPenalty"] as? NSNumber {
      parameters.repetitionPenalty = Float(truncating: repetitionPenalty)
    }

    if let repetitionContext = options["repetitionContext"] as? NSNumber {
      parameters.repetitionContextSize = max(0, Int(truncating: repetitionContext))
    }

    return parameters
  }

  private func topPValue(for topK: Int) -> Float {
    guard topK > 0 else { return 0.99 }
    let normalized = min(max(Float(topK), 1), 400)
    let baseline: Float = 40
    let mapped = normalized / baseline
    return max(0.1, min(mapped, 0.99))
  }

  private func pruneConversationIfNeeded() {
    let maxMessages = 32
    guard conversation.count > maxMessages else { return }

    let dropCount: Int
    if let boundary = messageBoundaries.first(where: { $0 >= conversation.count - maxMessages }) {
      dropCount = boundary
    } else {
      dropCount = conversation.count - maxMessages
    }

    guard dropCount > 0, dropCount <= conversation.count else { return }
    conversation.removeFirst(dropCount)
    messageBoundaries = messageBoundaries.map { $0 - dropCount }.filter { $0 >= 0 }
  }
}

@objc(LLM)
@MainActor
public final class LLM: NSObject, LLMSpec {
  private let runtime: NativeLLMRuntime
  private var lastCPUSampleTime: CFAbsoluteTime?
  private var lastCPUTime: Double = 0
  private let logger = Logger(subsystem: "com.27pm.monGARS", category: "LLM")

  override public init() {
    runtime = NativeLLMRuntime(fallbackModelIDs: Self.loadFallbackModels())
    super.init()
  }

  // MARK: - LLMSpec

  
  nonisolated public func loadModel(_ path: String,
                                    options: [AnyHashable: Any]?,
                                    resolve: @escaping RCTPromiseResolveBlock,
                                    reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    let sendableOptions = toJSONOptions(options)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performLoadModel(path: path, options: sendableOptions, resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func unloadModel(_ resolve: @escaping RCTPromiseResolveBlock,
                                      reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performUnloadModel(resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func generate(_ prompt: String,
                                   options: [AnyHashable: Any]?,
                                   resolve: @escaping RCTPromiseResolveBlock,
                                   reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    let sendableOptions = toJSONOptions(options)
    Task(priority: .userInitiated) { @MainActor [weak self] in
      guard let self else { return }
      await self.performGenerate(prompt: prompt, options: sendableOptions, resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func embed(_ text: String,
                                resolve: @escaping RCTPromiseResolveBlock,
                                reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task(priority: .userInitiated) { @MainActor [weak self] in
      guard let self else { return }
      await self.performEmbed(text: text, resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func getPerformanceMetrics(_ resolve: @escaping RCTPromiseResolveBlock,
                                                reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performGetPerformanceMetrics(resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func getKVCacheSize(_ resolve: @escaping RCTPromiseResolveBlock,
                                         reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performGetKVCacheSize(resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func getKVCacheMaxSize(_ resolve: @escaping RCTPromiseResolveBlock,
                                            reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performGetKVCacheMaxSize(resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func clearKVCache(_ resolve: @escaping RCTPromiseResolveBlock,
                                       reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performClearKVCache(resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func addMessageBoundary(_ resolve: @escaping RCTPromiseResolveBlock,
                                             reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performAddMessageBoundary(resolve: box.resolve, reject: box.reject)
    }
  }

  
  nonisolated public func adjustPerformanceMode(_ mode: String,
                                                resolve: @escaping RCTPromiseResolveBlock,
                                                reject: @escaping RCTPromiseRejectBlock) {
    let box = PromiseBox(resolve, reject)
    Task { @MainActor [weak self] in
      guard let self else { return }
      await self.performAdjustPerformanceMode(mode: mode, resolve: box.resolve, reject: box.reject)
    }
  }

  // MARK: - Helpers

  // MARK: - Concurrency-safe helpers

  /// Wrap React Native promise blocks inside a Sendable box so we can safely
  /// capture them across concurrency boundaries. We ALWAYS dispatch back to main
  /// before invoking.
  private final class PromiseBox: @unchecked Sendable {
    let resolve: RCTPromiseResolveBlock
    let reject: RCTPromiseRejectBlock
    init(_ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock) {
      self.resolve = resolve
      self.reject = reject
    }
  }

  /// Convert arbitrary RN options into a Sendable JSONValue map.
  nonisolated private func toJSONOptions(_ raw: [AnyHashable: Any]?) -> [String: JSONValue] {
    guard let raw else { return [:] }
    var out: [String: JSONValue] = [:]
    for (k, v) in raw {
      if let key = k as? String {
        out[key] = JSONValue(from: v)
      }
    }
    return out
  }


  private func normalize(_ options: [AnyHashable: Any]?) -> [String: Any] {
    guard let options else { return [:] }
    var result: [String: Any] = [:]
    for (key, value) in options {
      guard let stringKey = key as? String else { continue }
      result[stringKey] = value
    }
    return result
  }

  @MainActor
  private func performLoadModel(path: String,
                                options: [String: JSONValue],
                                resolve: @escaping RCTPromiseResolveBlock,
                                reject: @escaping RCTPromiseRejectBlock) async {
    do {
      let details = try await runtime.loadModel(path: path, options: options)
      var payload: [String: Any] = [
        "status": "loaded",
        "model": details.identifier
      ]
      payload["contextLength"] = boxOptional(details.contextLength)
      payload["kvCacheMax"] = boxOptional(details.contextLength)
      resolveOnMainThread(resolve, payload)
    } catch {
      rejectOnMainThread(reject, error)
    }
  }

  @MainActor
  private func performUnloadModel(resolve: @escaping RCTPromiseResolveBlock,
                                  reject: @escaping RCTPromiseRejectBlock) async {
    await runtime.unload()
    resolveOnMainThread(resolve, true)
  }

  @MainActor
  private func performGenerate(prompt: String,
                               options: [String: JSONValue],
                               resolve: @escaping RCTPromiseResolveBlock,
                               reject: @escaping RCTPromiseRejectBlock) async {
    guard await runtime.isLoaded else {
      rejectOnMainThread(reject, NativeLLMError.modelNotLoaded)
      return
    }

    do {
      let summary = try await runtime.generate(prompt: prompt, options: options) { chunk in
        Task { @MainActor in MLXEvents.shared?.emitToken(chunk) }
      }
      Task { @MainActor in MLXEvents.shared?.emitCompleted() }

      var payload: [String: Any] = [
        "text": summary.text,
        "promptTokens": summary.promptTokens,
        "completionTokens": summary.generatedTokens,
        "duration": summary.duration,
        "kvCacheSize": summary.kvCacheSize
      ]
      payload["kvCacheMax"] = boxOptional(summary.kvCacheMax)
      if !summary.toolCalls.isEmpty {
        payload["toolCalls"] = summary.toolCalls.map { $0.asDictionary() }
      }
      resolveOnMainThread(resolve, payload)
    } catch {
      Task { @MainActor in
        MLXEvents.shared?.emitError("EGEN", message: error.localizedDescription)
      }
      rejectOnMainThread(reject, error)
    }
  }

  @MainActor
  private func performEmbed(text: String,
                            resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) async {
    do {
      let vector = try await runtime.embedding(for: text)
      resolveOnMainThread(resolve, vector)
    } catch {
      rejectOnMainThread(reject, error)
    }
  }

  @MainActor
  private func performGetPerformanceMetrics(resolve: @escaping RCTPromiseResolveBlock,
                                            reject: @escaping RCTPromiseRejectBlock) async {
    let info = await runtime.latestCompletion()
    let metrics: [String: Any] = [
      "memoryUsage": sampleMemoryUsage(),
      "cpuUsage": sampleCPUUsage(),
      "promptTokens": boxOptional(info?.promptTokenCount),
      "completionTokens": boxOptional(info?.generationTokenCount),
      "promptTime": boxOptional(info?.promptTime),
      "generationTime": boxOptional(info?.generateTime),
      "tokensPerSecond": boxOptional(info?.tokensPerSecond),
      "promptTokensPerSecond": boxOptional(info?.promptTokensPerSecond)
    ]
    resolveOnMainThread(resolve, metrics)
  }

  @MainActor
  private func performGetKVCacheSize(resolve: @escaping RCTPromiseResolveBlock,
                                     reject: @escaping RCTPromiseRejectBlock) async {
    let size = await runtime.kvCacheSize()
    resolveOnMainThread(resolve, size)
  }

  @MainActor
  private func performGetKVCacheMaxSize(resolve: @escaping RCTPromiseResolveBlock,
                                        reject: @escaping RCTPromiseRejectBlock) async {
    let size = await runtime.kvCacheMaxSize()
    resolveOnMainThread(resolve, size)
  }

  @MainActor
  private func performClearKVCache(resolve: @escaping RCTPromiseResolveBlock,
                                   reject: @escaping RCTPromiseRejectBlock) async {
    await runtime.clearCache()
    resolveOnMainThread(resolve, NSNull())
  }

  @MainActor
  private func performAddMessageBoundary(resolve: @escaping RCTPromiseResolveBlock,
                                         reject: @escaping RCTPromiseRejectBlock) async {
    await runtime.addBoundary()
    resolveOnMainThread(resolve, NSNull())
  }

  @MainActor
  private func performAdjustPerformanceMode(mode: String,
                                            resolve: @escaping RCTPromiseResolveBlock,
                                            reject: @escaping RCTPromiseRejectBlock) async {
    switch mode {
    case "low-memory", "power-saving":
      await runtime.setMaxKVCache(2048)
      resolveOnMainThread(resolve, true)
    case "balanced":
      await runtime.setMaxKVCache(4096)
      resolveOnMainThread(resolve, true)
    case "performance", "high_quality":
      await runtime.setMaxKVCache(8192)
      resolveOnMainThread(resolve, true)
    default:
      resolveOnMainThread(resolve, false)
    }
  }

  private func resolveOnMainThread(_ resolve: @escaping RCTPromiseResolveBlock, _ value: Any) {
    if Thread.isMainThread {
      resolve(value)
    } else {
      DispatchQueue.main.async { resolve(value) }
    }
  }

  private func boxOptional<T>(_ value: T?) -> Any {
    if let wrapped = value {
      return wrapped
    }
    return NSNull()
  }

  private func rejectOnMainThread(_ reject: @escaping RCTPromiseRejectBlock, _ error: Error) {
    let nsError = error as NSError
    let code: String
    if let nativeError = error as? NativeLLMError {
      code = nativeError.code
    } else {
      code = nsError.domain
    }

    let description = error.localizedDescription
    if Thread.isMainThread {
      reject(code, description, error)
    } else {
      DispatchQueue.main.async {
        reject(code, description, error)
      }
    }
  }

  private func sampleMemoryUsage() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }

    guard result == KERN_SUCCESS else { return 0.0 }
    let usedBytes = Double(info.resident_size)
    let totalBytes = Double(ProcessInfo.processInfo.physicalMemory)
    guard totalBytes > 0 else { return 0.0 }
    return min(max(usedBytes / totalBytes, 0.0), 1.0)
  }

  private func sampleCPUUsage() -> Double {
    var threadInfo = task_thread_times_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_thread_times_info_data_t>.size) / 4
    let result = withUnsafeMutablePointer(to: &threadInfo) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_THREAD_TIMES_INFO), $0, &count)
      }
    }

    guard result == KERN_SUCCESS else { return 0.0 }

    let user = Double(threadInfo.user_time.seconds) + Double(threadInfo.user_time.microseconds) / 1_000_000
    let system = Double(threadInfo.system_time.seconds) + Double(threadInfo.system_time.microseconds) / 1_000_000
    let total = user + system
    let now = CFAbsoluteTimeGetCurrent()

    defer {
      lastCPUSampleTime = now
      lastCPUTime = total
    }

    guard let previous = lastCPUSampleTime else { return 0.0 }
    let deltaTime = now - previous
    guard deltaTime > 0 else { return 0.0 }

    let deltaCPU = total - lastCPUTime
    guard deltaCPU > 0 else { return 0.0 }

    let cores = max(1.0, Double(ProcessInfo.processInfo.activeProcessorCount))
    let usage = deltaCPU / deltaTime / cores
    return min(max(usage, 0.0), 1.0)
  }

  private static func loadFallbackModels() -> [String] {
    let candidateURLs: [URL?] = [
      Bundle.main.url(
        forResource: "fallback_models",
        withExtension: "json",
        subdirectory: "Models"
      ),
      Bundle.main.url(
        forResource: "fallback_models",
        withExtension: "json"
      )
    ]

    for case let url? in candidateURLs {
      if let data = try? Data(contentsOf: url),
         let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let models = json["fallback_models"] as? [String],
         !models.isEmpty {
        return models
      }
    }

    return [
      "Qwen/Qwen2-1.5B-Instruct-MLX",
      "mlx-community/gemma-2-2b-it",
      "mlx-community/llama-3.1-instruct-8b",
      "mlx-community/phi-3-mini-4k-instruct",
      "openaccess-ai-collective/tiny-mistral"
    ]
  }
}



