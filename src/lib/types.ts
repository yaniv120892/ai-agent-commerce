import type { OpenAIModelSelection } from "@/domain/chat/types";

export type Environment = {
  databaseUrl: string;
  e2eMode: boolean;
  openAiApiKey: string;
  openAiModels: OpenAIModelSelection;
  openAiTimeoutMs: number;
  openAiMaxRetries: number;
  openAiMaxOutputTokens: number;
  dummyJsonBaseUrl: string;
  dummyJsonTimeoutMs: number;
  redisUrl: string;
  catalogCacheListTtlSeconds: number;
  catalogCacheDetailTtlSeconds: number;
  replyCompletionCacheTtlSeconds: number;
};
