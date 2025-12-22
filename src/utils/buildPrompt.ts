import {
  USER_PROMPT_BUILDER_ID,
  getPromptDefinition,
} from "../core/prompt/PromptRegistry";

const promptTemplate = getPromptDefinition(USER_PROMPT_BUILDER_ID).template;

const renderPromptTemplate = (
  template: string,
  values: Record<string, string>,
) =>
  Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  );

export function buildPrompt(opts: {
  query: string;
  textEmotion: string | null;
  audioEmotion: string | null;
  context: string;
}) {
  const emotion = opts.audioEmotion ?? opts.textEmotion;
  let prompt = opts.query;
  if (emotion) {
    prompt = `${renderPromptTemplate(promptTemplate.emotion_prefix, {
      emotion,
    })}${prompt}`;
  }
  if (opts.context) {
    prompt = `${renderPromptTemplate(promptTemplate.context_prefix, {
      context: opts.context,
    })}${prompt}`;
  }
  return prompt;
}
