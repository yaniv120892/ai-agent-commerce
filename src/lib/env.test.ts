import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import * as environmentModule from "./env";

const createEnvironment = environmentModule.createEnvironment as unknown as (
  values: NodeJS.ProcessEnv,
) => unknown;

it("rejects an invalid DummyJSON base URL", () => {
  expect(() =>
    createEnvironment({
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
      DUMMYJSON_BASE_URL: "not-a-url",
      DUMMYJSON_TIMEOUT_MS: "5000",
    }),
  ).toThrow("DUMMYJSON_BASE_URL");
});

it("rejects a DummyJSON URL on an unapproved host", () => {
  expect(() =>
    createEnvironment({
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
      DUMMYJSON_BASE_URL: "https://example.com",
      DUMMYJSON_TIMEOUT_MS: "5000",
    }),
  ).toThrow("DUMMYJSON_BASE_URL");
});

it("rejects an invalid REDIS_URL", () => {
  expect(() =>
    createEnvironment({
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
      REDIS_URL: "not-a-url",
    }),
  ).toThrow("REDIS_URL");
});

it("applies default REDIS_URL, catalog cache TTLs, and OpenAI bounds when unset", () => {
  const parsedEnvironment = createEnvironment({
    DATABASE_URL: "postgresql://localhost/ai_commerce",
    OPENAI_API_KEY: "test-key",
  }) as {
    redisUrl: string;
    catalogCacheListTtlSeconds: number;
    catalogCacheDetailTtlSeconds: number;
    openAiTimeoutMs: number;
    openAiMaxRetries: number;
    openAiMaxOutputTokens: number;
  };

  expect(parsedEnvironment.redisUrl).toBe("redis://localhost:6379");
  expect(parsedEnvironment.catalogCacheListTtlSeconds).toBe(300);
  expect(parsedEnvironment.catalogCacheDetailTtlSeconds).toBe(1800);
  expect(parsedEnvironment.openAiTimeoutMs).toBe(20000);
  expect(parsedEnvironment.openAiMaxRetries).toBe(1);
  expect(parsedEnvironment.openAiMaxOutputTokens).toBe(2000);
});

it("allows OPENAI_MAX_RETRIES to be set to zero", () => {
  const parsedEnvironment = createEnvironment({
    DATABASE_URL: "postgresql://localhost/ai_commerce",
    OPENAI_API_KEY: "test-key",
    OPENAI_MAX_RETRIES: "0",
  }) as { openAiMaxRetries: number };

  expect(parsedEnvironment.openAiMaxRetries).toBe(0);
});

it("rejects a non-numeric OPENAI_TIMEOUT_MS", () => {
  expect(() =>
    createEnvironment({
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
      OPENAI_TIMEOUT_MS: "not-a-number",
    }),
  ).toThrow("OPENAI_TIMEOUT_MS");
});

it("exposes the configured OpenAI models", () => {
  const parsedEnvironment = createEnvironment({
    DATABASE_URL: "postgresql://localhost/ai_commerce",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "configured-model",
    OPENAI_PLANNER_MODEL: "planner-canary",
  }) as {
    openAiModels: { plannerModel: string; replyModel: string };
  };

  expect(parsedEnvironment.openAiModels).toEqual({
    plannerModel: "planner-canary",
    replyModel: "configured-model",
  });
});

it("rejects an empty OPENAI_MODEL", () => {
  expect(() =>
    createEnvironment({
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "",
    }),
  ).toThrow("OPENAI_MODEL");
});

it("rejects E2E mode outside development", () => {
  expect(() =>
    createEnvironment({
      DATABASE_URL: "postgresql://localhost/ai_commerce",
      E2E_MODE: "true",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    }),
  ).toThrow("E2E_MODE");
});

it("marks the environment module as server-only", () => {
  const environmentModuleSource = readFileSync(
    resolve(process.cwd(), "src/lib/env.ts"),
    "utf8",
  );

  expect(environmentModuleSource).toContain('import "server-only"');
});
