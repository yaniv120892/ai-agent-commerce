export type Environment = {
  databaseUrl: string;
  e2eMode: boolean;
  openAiApiKey: string;
  dummyJsonBaseUrl: string;
  dummyJsonTimeoutMs: number;
  redisUrl: string;
  catalogCacheListTtlSeconds: number;
  catalogCacheDetailTtlSeconds: number;
};
