import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import logger from "./logger";
import { TOOL_SCHEMA_VERSION } from "../core/prompt/promptTemplate";

const TELEMETRY_TAG = "Telemetry";
const MAX_VALUE_LENGTH = 2000;
const DEFAULT_FILE_NAME = "events.jsonl";

const sensitiveKeyPattern = /(token|secret|password|auth|api[_-]?key|session)/i;

const redactString = (value) => {
  if (!value) return value;
  let result = value;
  result = result.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[REDACTED_EMAIL]",
  );
  result = result.replace(/\+?\d[\d\s().-]{7,}\d/g, "[REDACTED_PHONE]");
  result = result.replace(
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g,
    "[REDACTED_TOKEN]",
  );
  result = result.replace(/\bBearer\s+[A-Za-z0-9._-]+\b/g, "Bearer [REDACTED]");
  if (result.length > MAX_VALUE_LENGTH) {
    result = `${result.slice(0, MAX_VALUE_LENGTH)}…[TRUNCATED]`;
  }
  return result;
};

export const redactTelemetryValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactTelemetryValue(entry));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (sensitiveKeyPattern.test(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, redactTelemetryValue(entry)];
      }),
    );
  }
  return String(value);
};

export const hashString = (value) => {
  if (value === null || value === undefined) return "";
  const input = String(value);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16)}`;
};

const getTelemetryDirectory = () => {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    return null;
  }
  return `${FileSystem.documentDirectory}telemetry/`;
};

const ensureTelemetryDirectory = async () => {
  const directory = getTelemetryDirectory();
  if (!directory) return null;
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    return directory;
  } catch (error) {
    logger.warn(TELEMETRY_TAG, "Unable to create telemetry directory", error);
    return null;
  }
};

let isWriting = false;
const pendingEvents = [];
let pendingDirectory = null;

const appendJsonLines = async (filePath, lines) => {
  const payload = lines.join("");
  try {
    await FileSystem.writeAsStringAsync(filePath, payload, {
      encoding: FileSystem.EncodingType.UTF8,
      append: true,
    });
    return;
  } catch (error) {
    logger.debug(
      TELEMETRY_TAG,
      "Append write not supported, falling back",
      error,
    );
  }

  const info = await FileSystem.getInfoAsync(filePath);
  if (info.exists) {
    const current = await FileSystem.readAsStringAsync(filePath);
    await FileSystem.writeAsStringAsync(filePath, `${current}${payload}`);
  } else {
    await FileSystem.writeAsStringAsync(filePath, payload);
  }
};

const flushTelemetryQueue = async () => {
  if (isWriting) {
    return null;
  }
  if (!pendingEvents.length) {
    return null;
  }
  isWriting = true;
  try {
    const directory = pendingDirectory || (await ensureTelemetryDirectory());
    if (!directory) {
      pendingEvents.splice(0, pendingEvents.length);
      return null;
    }
    pendingDirectory = directory;
    const filePath = `${directory}${DEFAULT_FILE_NAME}`;
    const lines = pendingEvents.splice(0, pendingEvents.length);
    await appendJsonLines(filePath, lines);
    return filePath;
  } catch (error) {
    logger.warn(TELEMETRY_TAG, "Failed to flush telemetry queue", error);
    return null;
  } finally {
    isWriting = false;
    if (pendingEvents.length) {
      void flushTelemetryQueue();
    }
  }
};

export const buildTelemetryEvent = (event) => {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    tool_schema_version: TOOL_SCHEMA_VERSION,
    ...redactTelemetryValue(event),
  };
};

export const logTelemetryEvent = async (event) => {
  const payload = buildTelemetryEvent(event);
  pendingEvents.push(`${JSON.stringify(payload)}\n`);
  return flushTelemetryQueue();
};

export const buildToolInvocationEvent = ({
  promptHash,
  toolName,
  args,
  success,
  latencyMs,
  resultSize,
  error,
}) => ({
  event: "tool_invocation",
  prompt_hash: promptHash,
  tool_name: toolName,
  tool_args_hash: hashString(JSON.stringify(redactTelemetryValue(args))),
  tool_args_preview: redactTelemetryValue(args),
  tool_result_size: resultSize,
  success,
  latency_ms: latencyMs,
  error: error ? String(error) : undefined,
});

export const buildPromptEvent = ({ promptHash, promptText }) => ({
  event: "prompt_received",
  prompt_hash: promptHash,
  prompt_preview: redactTelemetryValue(promptText),
});

export const buildFinalResponseEvent = ({
  promptHash,
  responseText,
  toolCallsCount,
}) => ({
  event: "final_response",
  prompt_hash: promptHash,
  response_hash: hashString(responseText || ""),
  response_preview: redactTelemetryValue(responseText),
  tool_calls_count: toolCallsCount,
});

export const buildRetrievalEvent = ({
  query,
  resultIds,
  maxResults,
  latencyMs,
  candidateIds,
  candidateScores,
}) => ({
  event: "retrieval",
  query_hash: hashString(query),
  query_preview: redactTelemetryValue(query),
  result_ids: resultIds,
  candidate_ids: candidateIds,
  candidate_scores: candidateScores,
  max_results: maxResults,
  latency_ms: latencyMs,
});
