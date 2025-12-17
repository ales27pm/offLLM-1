import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  tag: string;
  message: string;
  data?: unknown;
  error?: Error;
}

class Logger {
  private static instance: Logger;

  private logs: LogEntry[] = [];

  private maxLogs = 1000;

  private readonly isProduction = process?.env?.NODE_ENV === "production";

  private readonly isTest = process?.env?.NODE_ENV === "test";

  private logLevel: LogLevel = this.isProduction
    ? LogLevel.WARN
    : LogLevel.DEBUG;

  private fileLoggingEnabled = false;

  private readonly canPersistLogs =
    Platform.OS !== "web" && typeof FileSystem.documentDirectory === "string";

  private lastSavedFilePath: string | null = null;

  private isWritingToFile = false;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private constructor() {
    // Initialization logic if needed
  }

  private get logDirectory(): string | null {
    if (!this.canPersistLogs || !FileSystem.documentDirectory) {
      return null;
    }
    return `${FileSystem.documentDirectory}logs/`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(level: LogLevel, tag: string, message: string): string {
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    return `[${timestamp}] [${levelName}] [${tag}] ${message}`;
  }

  private async ensureLogDirectory(): Promise<void> {
    const directory = this.logDirectory;
    if (!directory) {
      return;
    }
    try {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    } catch (error) {
      // Directory already exists or cannot be created; ignore in production
      if (!this.isProduction) {
        console.warn("Logger", "Unable to ensure log directory", error);
      }
    }
  }

  private addLog(
    level: LogLevel,
    tag: string,
    message: string,
    data?: unknown,
    error?: Error,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      tag,
      message,
      data,
      error,
    };
    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    if (!this.isProduction && !this.isTest) {
      const formatted = this.formatMessage(level, tag, message);
      switch (level) {
        case LogLevel.DEBUG:
          console.log(formatted, data ?? "");
          break;
        case LogLevel.INFO:
          console.info(formatted, data ?? "");
          break;
        case LogLevel.WARN:
          console.warn(formatted, data ?? "");
          break;
        case LogLevel.ERROR:
          console.error(formatted, error ?? data ?? "");
          break;
        default:
          console.log(formatted, data ?? "");
      }
    }

    if (this.fileLoggingEnabled) {
      this.writeLogsToFileWithGuard().catch((error) => {
        if (!this.isProduction) {
          console.warn("Logger", "Failed to persist logs", error);
        }
      });
    }
  }

  debug(tag: string, message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.addLog(LogLevel.DEBUG, tag, message, data);
    }
  }

  info(tag: string, message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.addLog(LogLevel.INFO, tag, message, data);
    }
  }

  warn(tag: string, message: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.addLog(LogLevel.WARN, tag, message, data);
    }
  }

  error(tag: string, message: string, error?: unknown, data?: unknown): void {
    if (!this.shouldLog(LogLevel.ERROR)) {
      return;
    }
    const normalizedError =
      error instanceof Error
        ? error
        : error !== undefined && error !== null
          ? new Error(String(error))
          : undefined;
    this.addLog(LogLevel.ERROR, tag, message, data, normalizedError);
  }

  time(tag: string, label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.debug(tag, `⏱️ Timer started: ${label}`);
    }
  }

  timeEnd(tag: string, label: string, startTime: number): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const duration = Date.now() - startTime;
      this.debug(tag, `⏱️ Timer ended: ${label} - ${duration}ms`);
    }
  }

  apiRequest(tag: string, method: string, url: string, data?: unknown): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.debug(tag, `🌐 API Request: ${method} ${url}`, data);
    }
  }

  apiResponse(
    tag: string,
    method: string,
    url: string,
    status: number,
    duration: number,
  ): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const emoji = status >= 400 ? "❌" : "✅";
      this.debug(
        tag,
        `🌐 API Response: ${emoji} ${method} ${url} - ${status} (${duration}ms)`,
      );
    }
  }

  getLogs(level?: LogLevel): LogEntry[] {
    const entries =
      level === undefined
        ? this.logs
        : this.logs.filter((log) => log.level >= level);
    return entries.map((log) => ({ ...log }));
  }

  clearLogs(): void {
    this.logs = [];
    this.info("Logger", "Logs cleared");
    if (this.fileLoggingEnabled) {
      this.writeLogsToFileWithGuard().catch((error) => {
        if (!this.isProduction) {
          console.warn("Logger", "Failed to persist logs", error);
        }
      });
    }
  }

  async exportLogs(): Promise<string> {
    const logs = this.getLogs();
    const logData = logs.map((log) => ({
      timestamp:
        log.timestamp instanceof Date
          ? log.timestamp.toISOString()
          : new Date(log.timestamp).toISOString(),
      level: LogLevel[log.level],
      tag: log.tag,
      message: log.message,
      data: log.data,
      error: log.error?.message,
    }));
    return JSON.stringify(logData, null, 2);
  }

  async saveLogsToFile(): Promise<string | null> {
    if (!this.canPersistLogs) {
      return null;
    }
    try {
      const filePath = await this.writeLogsToFileWithGuard(true);
      if (filePath) {
        this.info("Logger", `Logs saved to ${filePath}`);
      }
      return filePath;
    } catch (error) {
      this.error("Logger", "Failed to save logs to file", error);
      return null;
    }
  }

  private async writeLogsToFileWithGuard(
    force = false,
  ): Promise<string | null> {
    if ((!this.fileLoggingEnabled && !force) || !this.canPersistLogs) {
      return null;
    }
    if (this.isWritingToFile) {
      return this.lastSavedFilePath;
    }
    this.isWritingToFile = true;
    try {
      return await this.writeLogsToFile();
    } finally {
      this.isWritingToFile = false;
    }
  }

  private async writeLogsToFile(): Promise<string | null> {
    await this.ensureLogDirectory();
    const logData = await this.exportLogs();
    const dateStr = new Date()
      .toISOString()
      .split("T")[0]
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const directory = this.logDirectory;
    if (!directory) {
      return null;
    }
    const fileName = `mongars_logs_${dateStr}.json`;
    const filePath = `${directory}${fileName}`;
    await FileSystem.writeAsStringAsync(filePath, logData);
    this.lastSavedFilePath = filePath;
    return filePath;
  }

  async clearLogFile(): Promise<void> {
    if (!this.lastSavedFilePath || !this.canPersistLogs) {
      return;
    }
    try {
      await FileSystem.deleteAsync(this.lastSavedFilePath, {
        idempotent: true,
      });
      this.lastSavedFilePath = null;
    } catch (error) {
      if (!this.isProduction) {
        console.warn("Logger", "Failed to delete log file", error);
      }
    }
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
    this.info("Logger", `Log level set to ${LogLevel[level]}`);
  }

  setFileLoggingEnabled(enabled: boolean): void {
    this.fileLoggingEnabled = enabled && this.canPersistLogs;
    if (this.fileLoggingEnabled) {
      this.writeLogsToFileWithGuard(true).catch((error) => {
        if (!this.isProduction) {
          console.warn("Logger", "Failed to persist logs", error);
        }
      });
    } else {
      void this.clearLogFile();
    }
  }
}

export const logger = Logger.getInstance();
export default logger;
