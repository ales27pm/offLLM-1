import Foundation
import React
import MLXLLM
import MLXLMCommon

@objc(MLXModule)
@MainActor
class MLXModule: RCTEventEmitter {
    @objc class func moduleName() -> String! {
        return "MLXModule"
    }
    @objc override public static func requiresMainQueueSetup() -> Bool {
        return false
    }

    private var hasListeners = false

    @objc override open func supportedEvents() -> [String]! {
        return ["MLXTextChunk", "MLXError"]
    }

    @objc override open func startObserving() {
        hasListeners = true
    }

    @objc override open func stopObserving() {
        hasListeners = false
    }

    @objc func generateText(_ options: NSDictionary,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task(priority: .userInitiated) { @MainActor in
            // Parse required parameters
            guard let modelId = options["modelId"] as? String else {
                reject("MLXModule", "Missing or invalid modelId", nil)
                return
            }
            guard let prompt = options["prompt"] as? String else {
                reject("MLXModule", "Missing or invalid prompt", nil)
                return
            }
            let streaming = (options["streaming"] as? Bool) ?? false

            print("[MLXModule] Loading model: \(modelId)")
            do {
                // Load the model asynchronously
                let loadStart = Date()
                let model = try await loadModel(id: modelId)
                let loadTime = Date().timeIntervalSince(loadStart)
                print("[MLXModule] Model loaded in \(loadTime)s")

                // Create a chat session for text generation
                let session = ChatSession(model)

                // Start inference
                let genStart = Date()
                if streaming && hasListeners {
                    print("[MLXModule] Starting streaming generation")
                    var fullOutput = ""
                    // Stream tokens as they are generated
                    for try await chunk in session.streamResponse(to: prompt) {
                        if hasListeners {
                            self.sendEvent(withName: "MLXTextChunk", body: chunk)
                        }
                        fullOutput += chunk
                    }
                    let genTime = Date().timeIntervalSince(genStart)
                    print("[MLXModule] Streaming generation complete in \(genTime)s")
                    resolve(["text": fullOutput, "duration": genTime])
                } else {
                    // Fallback: generate full response at once
                    let output = try await session.respond(to: prompt)
                    let genTime = Date().timeIntervalSince(genStart)
                    print("[MLXModule] Generation complete in \(genTime)s")
                    resolve(["text": output, "duration": genTime])
                }
            } catch {
                // Handle errors
                let errorMsg = error.localizedDescription
                print("[MLXModule] Error during text generation: \(errorMsg)")
                if hasListeners {
                    self.sendEvent(withName: "MLXError", body: ["error": errorMsg])
                }
                reject("MLXError", errorMsg, error)
            }
        }
    }
}



