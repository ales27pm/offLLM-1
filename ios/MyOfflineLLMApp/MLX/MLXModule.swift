import Foundation
import React
@preconcurrency import MLXLLM
@preconcurrency import MLXLMCommon

private struct PromiseCallbacks: @unchecked Sendable {
    let resolve: RCTPromiseResolveBlock
    let reject: RCTPromiseRejectBlock
}

actor ModelActor {
    private var container: ModelContainer?
    private var isResponding = false
    private let batchInterval: TimeInterval = 0.05

    func load(configuration: ModelConfiguration) async throws -> String {
        let container = try await LLMModelFactory.shared.loadContainer(
            configuration: configuration
        )
        self.container = container
        return configuration.name
    }

    func unload() {
        container = nil
        isResponding = false
    }

    // MARK: - Non-streaming (accumulate tokens)

    func generate(
        prompt: String,
        parameters: GenerateParameters
    ) async throws -> String {

        guard let container else {
            throw NSError(
                domain: "MLX",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Model not loaded"]
            )
        }
        guard !isResponding else {
            throw NSError(
                domain: "MLX",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Model busy"]
            )
        }

        isResponding = true
        defer { isResponding = false }

        return try await container.perform { context in
            let input = try await context.processor.prepare(
                input: .init(prompt: prompt)
            )

            let stream = try MLXLMCommon.generate(
                input: input,
                parameters: parameters,
                context: context
            )

            var output = ""
            for await blob in stream {
                if let token = blob.chunk {
                    output += token
                }
            }
            return output
        }
    }

    // MARK: - Streaming

    func generateStream(
        prompt: String,
        parameters: GenerateParameters
    ) async throws {

        guard let container else {
            throw NSError(
                domain: "MLX",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Model not loaded"]
            )
        }
        guard !isResponding else {
            throw NSError(
                domain: "MLX",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Model busy"]
            )
        }

        isResponding = true
        defer { isResponding = false }

        _ = try await container.perform { context in
            let input = try await context.processor.prepare(
                input: .init(prompt: prompt)
            )

            let result = try MLXLMCommon.generate(
                input: input,
                parameters: parameters,
                context: context
            )

            var buffer = ""
            var lastEmit = Date()

            for await blob in result {
                guard let token = blob.chunk else { continue }
                buffer += token

                let now = Date()
                if now.timeIntervalSince(lastEmit) >= batchInterval || buffer.count > 50 {
                    let chunk = buffer
                    buffer = ""
                    lastEmit = now
                    Task { @MainActor in
                        MLXEvents.shared?.emitToken(chunk)
                    }
                }
            }

            if !buffer.isEmpty {
                Task { @MainActor in
                    MLXEvents.shared?.emitToken(buffer)
                }
            }

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

        if let temp = options?["temperature"] as? NSNumber {
            params.temperature = temp.floatValue
        }
        if let topK = options?["topK"] as? NSNumber {
            let k = topK.floatValue
            params.topP = min(max(k / 100.0, 0.1), 1.0)
        }
        return params
    }

    @objc(load:resolver:rejecter:)
    func load(
        modelID: NSString?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let id = modelID as String? ?? "mlx-community/Llama-3.2-3B-Instruct-4bit"
        let callbacks = PromiseCallbacks(resolve: resolve, reject: reject)
        let actor = modelActor
        Task.detached(priority: .userInitiated) {
            do {
                let name = try await actor.load(
                    configuration: ModelConfiguration(id: id)
                )
                await MainActor.run {
                    callbacks.resolve(["id": name, "status": "loaded"])
                }
            } catch {
                await MainActor.run {
                    callbacks.reject("LOAD_FAIL", error.localizedDescription, error)
                }
            }
        }
    }

    @objc(generate:options:resolver:rejecter:)
    func generate(
        prompt: NSString,
        options: NSDictionary?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let params = makeParams(options: options)
        let callbacks = PromiseCallbacks(resolve: resolve, reject: reject)
        let actor = modelActor
        Task.detached(priority: .userInitiated) {
            do {
                let text = try await actor.generate(
                    prompt: prompt as String,
                    parameters: params
                )
                await MainActor.run {
                    callbacks.resolve(text)
                }
            } catch {
                await MainActor.run {
                    callbacks.reject("GEN_FAIL", error.localizedDescription, error)
                }
            }
        }
    }

    @objc(startStream:options:resolver:rejecter:)
    func startStream(
        prompt: NSString,
        options: NSDictionary?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let params = makeParams(options: options)
        let callbacks = PromiseCallbacks(resolve: resolve, reject: reject)
        let actor = modelActor
        Task.detached(priority: .userInitiated) {
            await MainActor.run {
                callbacks.resolve(nil)
            }
            do {
                try await actor.generateStream(
                    prompt: prompt as String,
                    parameters: params
                )
                Task { @MainActor in
                    MLXEvents.shared?.emitCompleted()
                }
            } catch {
                await MainActor.run {
                    callbacks.reject(
                        "STREAM_FAIL",
                        error.localizedDescription,
                        error
                    )
                }
            }
        }
    }

    @objc(unload)
    func unload() {
        let actor = modelActor
        Task.detached(priority: .utility) {
            await actor.unload()
        }
    }

    @objc(reset)
    func reset() {}

    @objc(stop)
    func stop() {}
}
