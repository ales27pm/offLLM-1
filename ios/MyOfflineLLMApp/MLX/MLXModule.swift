import Foundation
import React
@preconcurrency import MLXLLM
@preconcurrency import MLXLMCommon

actor ModelActor {
    private var container: ModelContainer?
    private var isResponding = false
    private let batchInterval: TimeInterval = 0.05

    func load(configuration: ModelConfiguration) async throws -> String {
        let container = try await LLMModelFactory.shared.loadContainer(configuration: configuration)
        self.container = container
        return configuration.name
    }

    func unload() {
        self.container = nil
        self.isResponding = false
    }

    func generate(prompt: String, parameters: GenerateParameters) async throws -> String {
        guard let container = container else { throw NSError(domain: "MLX", code: 1, userInfo: [NSLocalizedDescriptionKey: "Model not loaded"]) }
        guard !isResponding else { throw NSError(domain: "MLX", code: 2, userInfo: [NSLocalizedDescriptionKey: "Busy"]) }

        isResponding = true
        defer { isResponding = false }

        let output = try await container.perform { context in
            let input = try await context.processor.prepare(input: .init(prompt: prompt))
            return try MLXLMCommon.generate(input: input, parameters: parameters, context: context)
        }
        return output.text
    }

    func generateStream(prompt: String, parameters: GenerateParameters) async throws {
        guard let container = container else { throw NSError(domain: "MLX", code: 1, userInfo: [NSLocalizedDescriptionKey: "Model not loaded"]) }
        guard !isResponding else { throw NSError(domain: "MLX", code: 2, userInfo: [NSLocalizedDescriptionKey: "Busy"]) }

        isResponding = true
        defer { isResponding = false }

        try await container.perform { context in
            let input = try await context.processor.prepare(input: .init(prompt: prompt))
            let result = try MLXLMCommon.generate(input: input, parameters: parameters, context: context)

            var buffer = ""
            var lastEmitTime = Date()

            for await blob in result {
                guard let token = blob.chunk else { continue }
                buffer += token

                let now = Date()
                if now.timeIntervalSince(lastEmitTime) >= self.batchInterval || buffer.count > 50 {
                    let chunk = buffer
                    buffer = ""
                    lastEmitTime = now
                    Task { @MainActor in MLXEvents.shared?.emitToken(chunk) }
                }
            }
            if !buffer.isEmpty { Task { @MainActor in MLXEvents.shared?.emitToken(buffer) } }
            return result
        }
    }
}

@objc(MLXModule)
final class MLXModule: NSObject {
    private let modelActor = ModelActor()
    @objc static func moduleName() -> String! { "MLXModule" }
    @objc static func requiresMainQueueSetup() -> Bool { false }

    private func makeParams(options: NSDictionary?) -> GenerateParameters {
        var params = GenerateParameters()
        if let temp = options?["temperature"] as? NSNumber { params.temperature = temp.floatValue }
        if let topK = options?["topK"] as? NSNumber {
            let k = topK.floatValue
            params.topP = min(max(k / 100.0, 0.1), 1.0)
        }
        return params
    }

    @objc(load:resolver:rejecter:)
    func load(modelID: NSString?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let mid = modelID as String? ?? "mlx-community/Llama-3.2-3B-Instruct-4bit"
        Task {
            do {
                let name = try await modelActor.load(configuration: ModelConfiguration(id: mid))
                resolve(["id": name, "status": "loaded"])
            } catch { reject("LOAD_FAIL", error.localizedDescription, error) }
        }
    }

    @objc(generate:options:resolver:rejecter:)
    func generate(prompt: NSString, options: NSDictionary?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let params = makeParams(options: options)
        Task {
            do {
                let text = try await modelActor.generate(prompt: prompt as String, parameters: params)
                resolve(text)
            } catch { reject("GEN_FAIL", error.localizedDescription, error) }
        }
    }

    @objc(startStream:options:resolver:rejecter:)
    func startStream(prompt: NSString, options: NSDictionary?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let params = makeParams(options: options)
        Task {
            resolve(nil)
            do {
                try await modelActor.generateStream(prompt: prompt as String, parameters: params)
                Task { @MainActor in MLXEvents.shared?.emitCompleted() }
            } catch {
                Task { @MainActor in MLXEvents.shared?.emitError("STREAM_FAIL", message: error.localizedDescription) }
            }
        }
    }

    @objc(unload) func unload() { Task { await modelActor.unload() } }
    @objc(reset) func reset() {}
    @objc(stop) func stop() {}
}

