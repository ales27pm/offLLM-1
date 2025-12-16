import Foundation
import os
import React

@objc(Logging)
class Logging: NSObject, RCTBridgeModule {
  static func moduleName() -> String! { "Logging" }
  static func requiresMainQueueSetup() -> Bool { false }

  @objc func log(_ level: String, tag: String, message: String) {
    let logger = os.Logger(subsystem: "com.27pm.monGARS", category: tag)
    switch level {
    case "debug":
      logger.debug("\(message, privacy: .public)")
    case "info":
      logger.info("\(message, privacy: .public)")
    case "warn":
      logger.warning("\(message, privacy: .public)")
    case "error":
      logger.error("\(message, privacy: .public)")
    default:
      logger.log("\(message, privacy: .public)")
    }
  }
}



