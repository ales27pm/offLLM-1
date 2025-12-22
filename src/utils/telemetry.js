import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import Ajv from "ajv";
import SHA256 from "crypto-js/sha256";
import logger from "./logger";
import { TOOL_SCHEMA_VERSION } from "../core/prompt/promptTemplate";

const TELEMETRY_TAG = "Telemetry";
const MAX_VALUE_LENGTH = 2000;
const DEFAULT_FILE_NAME = "events.jsonl";
const TELEMETRY_SCHEMA_VERSION = "telemetry_v1";

const redactionPatterns = require("../../schemas/redaction_patterns.json");
const sensitiveKeyPattern = new RegExp(redactionPatterns.sensitive_key, "i");
const telemetrySchema = require("../../schemas/telemetry_event.schema.json");
const emailPattern = new RegExp(redactionPatterns.email, "gi");
const phonePattern = new RegExp(redactionPatterns.phone, "g");
const tokenPattern = new RegExp(redactionPatterns.token, "g");
const secretPattern = new RegExp(redactionPatterns.secret, "gi");
const bearerPattern = new RegExp(redactionPatterns.bearer, "g");

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const validateTelemetry = ajv.compile(telemetrySchema);

const stableSort = (value) => {
  if (Array.isArray(value)) return value.map((entry) => stableSort(entry));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(stableSort(value));

const redactString = (value) => {
  if (!value) return value;
  let result = value;
  result = result.replace(emailPattern, "[REDACTED_EMAIL]");
  result = result.replace(phonePattern, "[REDACTED_PHONE]");
  result = result.replace(bearerPattern, "Bearer [REDACTED]");
  result = result.replace(tokenPattern, "[REDACTED_TOKEN]");
  result = result.replace(secretPattern, "[REDACTED_SECRET]");
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
  const input =
    typeof value === "string"
      ? value
      : stableStringify(redactTelemetryValue(value));
  return `sha256_${SHA256(input).toString()}`;
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
  let hadError = false;
  let lines = [];
  try {
    const directory = pendingDirectory || (await ensureTelemetryDirectory());
    if (!directory) {
      pendingEvents.splice(0, pendingEvents.length);
      return null;
    }
    pendingDirectory = directory;
    const filePath = `${directory}${DEFAULT_FILE_NAME}`;
    lines = pendingEvents.splice(0, pendingEvents.length);
    await appendJsonLines(filePath, lines);
    return filePath;
  } catch (error) {
    hadError = true;
    if (lines.length) {
      pendingEvents.unshift(...lines);
      logger.warn(
        TELEMETRY_TAG,
        `Failed to flush telemetry queue; re-queued ${lines.length} events`,
        error,
      );
    } else {
      logger.warn(TELEMETRY_TAG, "Failed to flush telemetry queue", error);
    }
    return null;
  } finally {
    isWriting = false;
    if (pendingEvents.length && !hadError) {
      void flushTelemetryQueue();
    }
  }
};

export const buildTelemetryEvent = (event) => {
  const timestamp = new Date().toISOString();
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    event_type: event.event_type,
    timestamp,
    tool_schema_version: TOOL_SCHEMA_VERSION,
    ...redactTelemetryValue(event),
  };
};

export const validateTelemetryEvent = (payload) => {
  const valid = validateTelemetry(payload);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateTelemetry.errors || []).map(
    (error) => `${error.instancePath || "(root)"} ${error.message}`,
  );
  return { valid: false, errors };
};

export const logTelemetryEvent = async (event) => {
  const payload = buildTelemetryEvent(event);
  const validation = validateTelemetryEvent(payload);
  if (!validation.valid) {
    logger.error(
      TELEMETRY_TAG,
      `Telemetry schema validation failed: ${validation.errors.join("; ")}`,
    );
    return null;
  }
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
  modelId,
}) => ({
  event_type: "tool_invocation",
  prompt_hash: promptHash,
  tool_name: toolName,
  tool_args_hash: hashString(args),
  tool_args_preview: redactTelemetryValue(args),
  tool_result_size: resultSize,
  success,
  latency_ms: latencyMs,
  error: error ? String(error) : null,
  model_id: modelId,
});

export const buildPromptEvent = ({ promptHash, promptText, modelId }) => ({
  event_type: "prompt_received",
  prompt_hash: promptHash,
  prompt_preview: redactTelemetryValue(promptText),
  model_id: modelId,
});

export const buildFinalResponseEvent = ({
  promptHash,
  responseText,
  toolCallsCount,
  modelId,
}) => ({
  event_type: "final_response",
  prompt_hash: promptHash,
  response_hash: hashString(responseText || ""),
  response_preview: redactTelemetryValue(responseText),
  tool_calls_count: toolCallsCount,
  model_id: modelId,
});

export const buildRetrievalEvent = ({
  query,
  resultIds,
  maxResults,
  latencyMs,
  candidateIds,
  candidateScores,
  modelId,
}) => ({
  event_type: "retrieval",
  query_hash: hashString(query),
  query_preview: redactTelemetryValue(query),
  result_ids: resultIds,
  max_results: maxResults,
  latency_ms: latencyMs,
  retrieval_trace: {
    candidate_ids: candidateIds,
    candidate_scores: candidateScores,
  },
  model_id: modelId,
});
