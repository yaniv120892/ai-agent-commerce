import "server-only";

import { DeterministicModelClient } from "@/domain/testing/deterministic-clients";

import type { OpenAIModelClientConfig } from "./openai-model-client";
import { OpenAIModelClient } from "./openai-model-client";
import type { ModelClient } from "./types";

export type CreateModelClientOptions = {
  e2eMode: boolean;
  openAiConfig: OpenAIModelClientConfig;
};

export function createModelClient(
  options: CreateModelClientOptions,
): ModelClient {
  if (options.e2eMode) {
    return new DeterministicModelClient();
  }

  return new OpenAIModelClient(options.openAiConfig);
}
