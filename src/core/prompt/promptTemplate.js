import {
  DEFAULT_RUNTIME_PROMPT_ID,
  DEFAULT_TRAINING_PROMPT_ID,
  getPromptDefinition,
} from "./PromptRegistry";

const runtimePrompt = getPromptDefinition(DEFAULT_RUNTIME_PROMPT_ID);
const template = runtimePrompt.template;

export const PROMPT_TEMPLATE_VERSION = runtimePrompt.version;
export const TOOL_SCHEMA_VERSION =
  runtimePrompt.expected_tool_schema?.tool_schema_version ?? "tool_schema_v1";

export const formatToolDescription = (tool) => {
  const parameters = JSON.stringify(tool.parameters || {});
  return template.tool_format
    .replaceAll("{name}", tool.name)
    .replaceAll("{description}", tool.description)
    .replaceAll("{parameters}", parameters);
};

export const buildPrompt = ({ toolsDesc, contextLines, userPrompt }) => {
  const promptSections = [
    template.system_intro,
    toolsDesc,
    template.instructions_title,
    template.instructions,
    template.context_title,
    contextLines,
    `${template.user_prefix} ${userPrompt}`,
    template.assistant_prefix,
  ].filter((segment) => segment !== "");

  return promptSections.join("\n");
};

export const getTrainingTemplate = () =>
  getPromptDefinition(DEFAULT_TRAINING_PROMPT_ID).template;

export default template;
