import Foundation

enum BundledModelLocator {
  private static let modelsRootFolder = "Models"

  static func directory(for identifier: String) -> URL? {
    let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let resourceRoot = Bundle.main.resourceURL else {
      return nil
    }

    let components = trimmed.split(separator: "/").map(String.init)
    guard !components.isEmpty else { return nil }

    var candidate = resourceRoot.appendingPathComponent(modelsRootFolder, isDirectory: true)
    for component in components {
      candidate.appendPathComponent(component, isDirectory: true)
    }

    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
          isDirectory.boolValue else {
      return nil
    }

    guard containsModelArtifacts(at: candidate) else { return nil }
    return candidate
  }

  private static func containsModelArtifacts(at directory: URL) -> Bool {
    guard let enumerator = FileManager.default.enumerator(
      at: directory,
      includingPropertiesForKeys: [.isRegularFileKey],
      options: [.skipsHiddenFiles]
    ) else {
      return false
    }

    for case let fileURL as URL in enumerator {
      let ext = fileURL.pathExtension.lowercased()
      if ext == "safetensors" || ext == "gguf" || ext == "bin" || ext == "mlx" {
        return true
      }
    }

    return false
  }
}



