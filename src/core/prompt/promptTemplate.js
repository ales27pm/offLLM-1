import template from "./promptTemplates.json";

export const PROMPT_TEMPLATE_VERSION = template.version;
export const TOOL_SCHEMA_VERSION = template.tool_schema_version;

export const formatToolDescription = (tool) => {
  const parameters = JSON.stringify(tool.parameters || {});
  return template.tool_format
    .replace("{name}", tool.name)
    .replace("{description}", tool.description)
    .replace("{parameters}", parameters);
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

export const getTrainingTemplate = () => template.training;

export default template;
