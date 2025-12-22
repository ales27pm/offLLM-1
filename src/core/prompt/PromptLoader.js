const TEMPLATE_FILES = {
  "prompts/v1/runtime_prompt.json": require("../../../prompts/v1/runtime_prompt.json"),
  "prompts/v1/training_prompt.json": require("../../../prompts/v1/training_prompt.json"),
};

const substitute = (template, vars) =>
  template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) return `{{${key}}}`;
    return String(vars[key]);
  });

const loadPromptTemplate = (promptPath) => {
  const template = TEMPLATE_FILES[promptPath];
  if (!template) {
    throw new Error(`Unknown prompt template file: ${promptPath}`);
  }
  if (!template || typeof template.template !== "string") {
    throw new Error(`Prompt JSON missing 'template' string: ${promptPath}`);
  }
  return template;
};

class PromptLoader {
  constructor(registry) {
    this.registry = registry;
  }

  loadAsString(id, version, vars = {}) {
    const entry = this.registry.getPromptEntry(id, version);
    const template = loadPromptTemplate(entry.file);
    return substitute(template.template, vars);
  }
}

export { PromptLoader };
