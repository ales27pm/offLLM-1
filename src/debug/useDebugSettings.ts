import create from "zustand";
import Config from "react-native-config";
import logger, { LogLevel } from "../utils/logger";

type DevFlagGlobal = typeof globalThis & { __DEV__?: boolean };

const devFlag =
  typeof globalThis !== "undefined" &&
  typeof (globalThis as DevFlagGlobal).__DEV__ !== "undefined"
    ? (globalThis as DevFlagGlobal).__DEV__
    : undefined;

// Prefer explicit "development" check; avoid defaulting to true when NODE_ENV is undefined.
const isDevelopment =
  typeof devFlag === "boolean"
    ? devFlag
    : process?.env?.NODE_ENV?.toLowerCase?.() === "development";
const DEBUG_LOGGING = Config.DEBUG_LOGGING === "1";

if (DEBUG_LOGGING) {
  logger.setFileLoggingEnabled(true);
}

export const useDebugSettings = create<{
  verbose: boolean;
  file: boolean;
  toggleVerbose: () => void;
  toggleFile: () => void;
}>((set) => ({
  verbose: isDevelopment,
  file: DEBUG_LOGGING,
  toggleVerbose: () =>
    set((state) => {
      const next = !state.verbose;
      logger.setLogLevel(next ? LogLevel.DEBUG : LogLevel.INFO);
      return { verbose: next };
    }),
  toggleFile: () =>
    set((state) => {
      const next = !state.file;
      logger.setFileLoggingEnabled(next);
      return { file: next };
    }),
}));
