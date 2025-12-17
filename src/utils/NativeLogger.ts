import { NativeModules, Platform } from "react-native";

export function logToNative(level: string, tag: string, message: string) {
  try {
    const mod: any = (NativeModules as any).Logging;
    if (Platform.OS === "ios" && mod && typeof mod.log === "function") {
      mod.log(level, tag, message);
    }
  } catch {
    // ignore native failures
  }
}
