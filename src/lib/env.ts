import "server-only";

import { z } from "zod";

import { resolveOpenAIModelSelection } from "./openai-model-config";
import type { Environment } from "./types";

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).optional(),
  OPENAI_PLANNER_MODEL: z.string().min(1).optional(),
  OPENAI_REPLY_MODEL: z.string().min(1).optional(),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(1),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2000),
  DUMMYJSON_BASE_URL: z
    .literal("https://dummyjson.com")
    .default("https://dummyjson.com"),
  DUMMYJSON_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  E2E_MODE: z.enum(["true", "false"]).default("false"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  CATALOG_CACHE_LIST_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  CATALOG_CACHE_DETAIL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(1800),
  REPLY_COMPLETION_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
});

export function createEnvironment(values: NodeJS.ProcessEnv): Environment {
  const parsedEnvironment = environmentSchema.parse(values);

  if (
    parsedEnvironment.E2E_MODE === "true" &&
    values.NODE_ENV !== "development"
  ) {
    throw new Error("E2E_MODE is allowed only in Next.js development mode");
  }

  const openAiModels = resolveOpenAIModelSelection(values);

  return {
    databaseUrl: parsedEnvironment.DATABASE_URL,
    openAiApiKey: parsedEnvironment.OPENAI_API_KEY,
    openAiModels,
    openAiTimeoutMs: parsedEnvironment.OPENAI_TIMEOUT_MS,
    openAiMaxRetries: parsedEnvironment.OPENAI_MAX_RETRIES,
    openAiMaxOutputTokens: parsedEnvironment.OPENAI_MAX_OUTPUT_TOKENS,
    dummyJsonBaseUrl: parsedEnvironment.DUMMYJSON_BASE_URL,
    dummyJsonTimeoutMs: parsedEnvironment.DUMMYJSON_TIMEOUT_MS,
    e2eMode: parsedEnvironment.E2E_MODE === "true",
    redisUrl: parsedEnvironment.REDIS_URL,
    catalogCacheListTtlSeconds:
      parsedEnvironment.CATALOG_CACHE_LIST_TTL_SECONDS,
    catalogCacheDetailTtlSeconds:
      parsedEnvironment.CATALOG_CACHE_DETAIL_TTL_SECONDS,
    replyCompletionCacheTtlSeconds:
      parsedEnvironment.REPLY_COMPLETION_CACHE_TTL_SECONDS,
  };
}

export const environment = createEnvironment(process.env);
