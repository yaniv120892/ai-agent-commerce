import "server-only";

import { z } from "zod";

import type { Environment } from "./types";

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  OPENAI_API_KEY: z.string().min(1),
  DUMMYJSON_BASE_URL: z
    .literal("https://dummyjson.com")
    .default("https://dummyjson.com"),
  DUMMYJSON_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export function createEnvironment(values: NodeJS.ProcessEnv): Environment {
  const parsedEnvironment = environmentSchema.parse(values);

  return {
    databaseUrl: parsedEnvironment.DATABASE_URL,
    openAiApiKey: parsedEnvironment.OPENAI_API_KEY,
    dummyJsonBaseUrl: parsedEnvironment.DUMMYJSON_BASE_URL,
    dummyJsonTimeoutMs: parsedEnvironment.DUMMYJSON_TIMEOUT_MS,
  };
}

export const environment = createEnvironment(process.env);
