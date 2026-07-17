import type { OpenAIModelSelection } from "@/domain/chat/types";

export type Environment = {
  databaseUrl: string;
  e2eMode: boolean;
  openAiApiKey: string;
  openAiModels: OpenAIModelSelection;
  dummyJsonBaseUrl: string;
  dummyJsonTimeoutMs: number;
  redisUrl: string;
  catalogCacheListTtlSeconds: number;
  catalogCacheDetailTtlSeconds: number;
};
