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
  E2E_MODE: z.enum(["true", "false"]).default("false"),
});

export function createEnvironment(values: NodeJS.ProcessEnv): Environment {
  const parsedEnvironment = environmentSchema.parse(values);

  if (
    parsedEnvironment.E2E_MODE === "true" &&
    values.NODE_ENV !== "development"
  ) {
    throw new Error("E2E_MODE is allowed only in Next.js development mode");
  }

  return {
    databaseUrl: parsedEnvironment.DATABASE_URL,
    openAiApiKey: parsedEnvironment.OPENAI_API_KEY,
    dummyJsonBaseUrl: parsedEnvironment.DUMMYJSON_BASE_URL,
    dummyJsonTimeoutMs: parsedEnvironment.DUMMYJSON_TIMEOUT_MS,
    e2eMode: parsedEnvironment.E2E_MODE === "true",
  };
}

export const environment = createEnvironment(process.env);
