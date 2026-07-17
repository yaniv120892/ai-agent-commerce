export type Environment = {
  databaseUrl: string;
  e2eMode: boolean;
  openAiApiKey: string;
  openAiTimeoutMs: number;
  openAiMaxRetries: number;
  openAiMaxOutputTokens: number;
  dummyJsonBaseUrl: string;
  dummyJsonTimeoutMs: number;
  redisUrl: string;
  catalogCacheListTtlSeconds: number;
  catalogCacheDetailTtlSeconds: number;
};
