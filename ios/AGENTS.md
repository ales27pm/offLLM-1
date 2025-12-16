# iOS Workspace Guidelines

- Keep `MyOfflineLLMApp/Info.plist` populated with required bundle metadata (executable name, identifier, versioning) and the usage-description strings relied on by native tools (calendar, contacts, location, microphone, motion, music, photos). Regenerating the plist must preserve these keys so archives remain valid.【F:ios/MyOfflineLLMApp/Info.plist†L5-L56】
- Coordinate plist or entitlement changes with XcodeGen’s `project.yml` so deployment targets, MLX package versions, bridging headers, and build settings stay in sync with runtime expectations.【F:ios/project.yml†L1-L118】
- `project.yml` already injects the MLX packages and system frameworks used by the TurboModules. If you add new native modules or Swift packages, declare them here so `xcodegen` and the doctor workflow pick up the dependencies automatically.【F:ios/project.yml†L36-L83】
