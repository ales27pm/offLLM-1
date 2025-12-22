export const PROMPT_REGISTRY_JSON = `{
  "registry_version": "1",
  "prompts": {
    "runtime_prompt_v1": {
      "id": "runtime_prompt",
      "version": "v1",
      "inputs_schema": {
        "type": "object",
        "properties": {
          "tools_desc": { "type": "string" },
          "context_lines": { "type": "string" },
          "user_prompt": { "type": "string" }
        },
        "required": ["tools_desc", "context_lines", "user_prompt"]
      },
      "expected_tool_schema": {
        "tool_schema_version": "tool_schema_v1"
      },
      "template": {
        "system_intro": "You are an AI assistant with access to:",
        "instructions_title": "Instructions:",
        "instructions": "Use tools when additional data or actions are required. Emit calls as TOOL_CALL: toolName(param=\\"value\\"). Reply directly when you already have the answer. Observe tool results to form your final answer.",
        "context_title": "Context:",
        "user_prefix": "User:",
        "assistant_prefix": "Assistant:",
        "tool_format": "Tool: {name} - {description} (Params: {parameters})"
      }
    },
    "training_prompt_v1": {
      "id": "training_prompt",
      "version": "v1",
      "inputs_schema": {
        "type": "object",
        "properties": {
          "instruction": { "type": "string" },
          "context": { "type": "string" },
          "schema": { "type": "string" },
          "tool": { "type": "string" },
          "answer": { "type": "string" }
        },
        "required": ["instruction", "context", "schema", "tool", "answer"]
      },
      "expected_tool_schema": {
        "tool_schema_version": "tool_schema_v1"
      },
      "template": {
        "system_prompt": "You are an AI assistant with access to tools. Use tools when additional data or actions are required. Emit calls as TOOL_CALL: toolName(param=\\"value\\"). Reply directly when you already have the answer. Observe tool results to form your final answer.",
        "user_prompt_template": "INSTRUCTION:\\n{instruction}\\nCONTEXT:\\n{context}\\nTOOL_SCHEMA:\\n{schema}",
        "assistant_template": "TOOL_CALL: {tool}\\nfinal_answer: {answer}"
      }
    },
    "tree_of_thought_candidate_v1": {
      "id": "tree_of_thought_candidate",
      "version": "v1",
      "inputs_schema": {
        "type": "object",
        "properties": {
          "current_thought": { "type": "string" },
          "max_candidates": { "type": "number" }
        },
        "required": ["current_thought", "max_candidates"]
      },
      "expected_tool_schema": null,
      "template": {
        "prompt": "Given the current thought: \\"{current_thought}\\"\\n\\nGenerate {max_candidates} diverse alternative approaches or next steps. Format as a numbered list:"
      }
    },
    "tree_of_thought_evaluation_v1": {
      "id": "tree_of_thought_evaluation",
      "version": "v1",
      "inputs_schema": {
        "type": "object",
        "properties": {
          "context": { "type": "string" },
          "thought": { "type": "string" }
        },
        "required": ["context", "thought"]
      },
      "expected_tool_schema": null,
      "template": {
        "prompt": "Evaluate the quality of this thought in the context of solving: \\"{context}\\"\\n\\nThought to evaluate: \\"{thought}\\"\\n\\nRate on a scale of 0.0 to 1.0 considering:\\n- Relevance to the problem\\n- Novelty and creativity\\n- Practical feasibility\\n- Logical coherence\\n\\nProvide only the numerical rating:"
      }
    },
    "tree_of_thought_fallback_candidates_v1": {
      "id": "tree_of_thought_fallback_candidates",
      "version": "v1",
      "inputs_schema": {
        "type": "object",
        "properties": {
          "thought": { "type": "string" }
        },
        "required": ["thought"]
      },
      "expected_tool_schema": null,
      "template": {
        "candidates": [
          "Consider alternative perspectives on: {thought}",
          "Break down the problem: {thought} into smaller components",
          "What are the assumptions behind: {thought}",
          "Consider the opposite of: {thought}",
          "How would an expert approach: {thought}"
        ]
      }
    },
    "user_prompt_builder_v1": {
      "id": "user_prompt_builder",
      "version": "v1",
      "inputs_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "emotion": { "type": ["string", "null"] },
          "context": { "type": ["string", "null"] }
        },
        "required": ["query"]
      },
      "expected_tool_schema": null,
      "template": {
        "emotion_prefix": "The user sounds {emotion}. ",
        "context_prefix": "Context:\\n{context}\\n\\n"
      }
    }
  }
}`;

export const PROMPT_REGISTRY = JSON.parse(PROMPT_REGISTRY_JSON);

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
