import registrySource from "../../../prompts/registry.json";

type PromptRegistryEntry = {
  id: string;
  version: string;
  inputs_schema?: Record<string, unknown> | null;
  expected_tool_schema?: Record<string, unknown> | null;
  template_file: string;
  template?: Record<string, unknown> | null;
};

type PromptRegistry = {
  registry_version: string;
  prompts: Record<string, PromptRegistryEntry>;
};

const TEMPLATE_FILES: Record<string, Record<string, unknown>> = {
  "prompts/v1/runtime_prompt.json": require("../../../prompts/v1/runtime_prompt.json"),
  "prompts/v1/training_prompt.json": require("../../../prompts/v1/training_prompt.json"),
  "prompts/v1/tree_of_thought_candidate.json": require("../../../prompts/v1/tree_of_thought_candidate.json"),
  "prompts/v1/tree_of_thought_evaluation.json": require("../../../prompts/v1/tree_of_thought_evaluation.json"),
  "prompts/v1/tree_of_thought_fallback_candidates.json": require("../../../prompts/v1/tree_of_thought_fallback_candidates.json"),
  "prompts/v1/user_prompt_builder.json": require("../../../prompts/v1/user_prompt_builder.json"),
};

const loadTemplate = (templateFile: string) => {
  const template = TEMPLATE_FILES[templateFile];
  if (!template) {
    throw new Error(`Unknown prompt template file: ${templateFile}`);
  }
  return template;
};

const hydrateRegistry = (source: PromptRegistry): PromptRegistry => {
  const prompts = Object.fromEntries(
    Object.entries(source.prompts).map(([key, entry]) => {
      if (!entry.template_file) {
        throw new Error(`Prompt registry entry missing template_file: ${key}`);
      }
      return [
        key,
        {
          ...entry,
          template: loadTemplate(entry.template_file),
        },
      ];
    }),
  );

  return {
    ...source,
    prompts,
  };
};

export const PROMPT_REGISTRY: PromptRegistry = hydrateRegistry(
  registrySource as PromptRegistry,
);

export const DEFAULT_RUNTIME_PROMPT_ID = "runtime_prompt_v1";
export const DEFAULT_TRAINING_PROMPT_ID = "training_prompt_v1";
export const TREE_OF_THOUGHT_CANDIDATE_ID = "tree_of_thought_candidate_v1";
export const TREE_OF_THOUGHT_EVALUATION_ID = "tree_of_thought_evaluation_v1";
export const TREE_OF_THOUGHT_FALLBACK_ID =
  "tree_of_thought_fallback_candidates_v1";
export const USER_PROMPT_BUILDER_ID = "user_prompt_builder_v1";

export const getPromptDefinition = (promptId: string) => {
  const definition = PROMPT_REGISTRY.prompts[promptId];
  if (!definition) {
    throw new Error(`Unknown prompt registry id: ${promptId}`);
  }
  return definition;
};
