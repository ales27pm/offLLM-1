//
//  MLXEvents.swift
//  monGARS
//
//  React Native event emitter for token streaming.
//

import Foundation
import React

@objc(MLXEvents)
@MainActor
final class MLXEvents: RCTEventEmitter {

  // RN requires this for Swift modules
  @objc override static func requiresMainQueueSetup() -> Bool { false }

  // Allow static access without tripping Swift 6 strict concurrency checks.
  // Use instance APIs only from the @MainActor.
  nonisolated(unsafe) private static weak var sharedStorage: MLXEvents?
  nonisolated(unsafe) static var shared: MLXEvents? { sharedStorage }

  override init() {
    super.init()
    MLXEvents.sharedStorage = self
  }

  deinit {
    if MLXEvents.sharedStorage === self { MLXEvents.sharedStorage = nil }
  }

  override func supportedEvents() -> [String]! {
    return ["mlxToken", "mlxCompleted", "mlxError", "mlxStopped"]
  }

  // Convenience senders
  func emitToken(_ text: String) {
    sendEvent(withName: "mlxToken", body: ["text": text])
  }

  func emitCompleted() {
    sendEvent(withName: "mlxCompleted", body: [:])
  }

  func emitError(_ code: String, message: String) {
    sendEvent(withName: "mlxError", body: ["code": code, "message": message])
  }

  func emitStopped() {
    sendEvent(withName: "mlxStopped", body: [:])
  }
}



