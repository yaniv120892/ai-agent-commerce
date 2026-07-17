import type { OpenAIModelSelection } from "@/domain/chat/types";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export function resolveOpenAIModelSelection(
  values: NodeJS.ProcessEnv,
): OpenAIModelSelection {
  const model = values.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

  return {
    plannerModel: values.OPENAI_PLANNER_MODEL ?? model,
    replyModel: values.OPENAI_REPLY_MODEL ?? model,
  };
}
