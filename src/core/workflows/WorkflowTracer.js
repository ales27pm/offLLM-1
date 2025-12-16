import logger from "../../utils/logger";

const DEFAULT_TAG = "AgentWorkflow";
const DEFAULT_PREVIEW_LIMIT = 160;

const generateRunId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const isFunction = (value) => typeof value === "function";

const normalizePreview = (value, limit = DEFAULT_PREVIEW_LIMIT) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}…`;
};

export class WorkflowTracer {
  constructor({ workflowName = "Workflow", tag = DEFAULT_TAG, runId } = {}) {
    this.workflowName = workflowName;
    this.tag = tag;
    this.runId = runId || generateRunId();
    this.startTime = Date.now();
    this.stepCounter = 0;
  }

  preview(value, limit = DEFAULT_PREVIEW_LIMIT) {
    return normalizePreview(value, limit);
  }

  debug(message, data) {
    logger.debug(this.tag, `${this.#prefix()} ${message}`, data);
  }

  info(message, data) {
    logger.info(this.tag, `${this.#prefix()} ${message}`, data);
  }

  warn(message, data) {
    logger.warn(this.tag, `${this.#prefix()} ${message}`, data);
  }

  error(message, error, data) {
    logger.error(this.tag, `${this.#prefix()} ${message}`, error, data);
  }

  startStep(name, data) {
    const step = {
      id: ++this.stepCounter,
      name,
      startTime: Date.now(),
    };

    this.debug(`▶️ ${name} start`, { step: step.id, ...data });
    return step;
  }

  endStep(step, data) {
    if (!step) {
      return;
    }

    const duration = Date.now() - step.startTime;
    this.info(`✅ ${step.name} completed`, {
      step: step.id,
      duration,
      ...data,
    });
  }

  failStep(step, error, data) {
    if (!step) {
      return;
    }

    const duration = Date.now() - step.startTime;
    this.error(`❌ ${step.name} failed`, error, {
      step: step.id,
      duration,
      ...data,
    });
  }

  async withStep(name, operation, options = {}) {
    const { startData, successData, errorData } = options;
    const step = this.startStep(name, startData);

    try {
      const result = await operation();
      const payload = isFunction(successData)
        ? successData(result)
        : successData;
      this.endStep(step, payload);
      return result;
    } catch (error) {
      const payload = isFunction(errorData) ? errorData(error) : errorData;
      this.failStep(step, error, payload);
      throw error;
    }
  }

  finish(data) {
    const duration = Date.now() - this.startTime;
    this.info("🏁 Workflow completed", { duration, ...data });
  }

  fail(error, data) {
    const duration = Date.now() - this.startTime;
    this.error("💥 Workflow failed", error, { duration, ...data });
  }

  #prefix() {
    return `[${this.workflowName}#${this.runId}]`;
  }
}

export default WorkflowTracer;



