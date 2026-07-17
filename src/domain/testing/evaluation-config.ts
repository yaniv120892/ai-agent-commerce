import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import type { EvaluationConfig } from "./evaluation-config.types";

export type {
  EvaluationConfig,
  ExpectedFailure,
  ModelPricing,
  OnlineEvaluationPolicy,
  SpendPolicy,
  SuiteEvaluationPolicy,
} from "./evaluation-config.types";

const configPath = resolve(process.cwd(), "tests/evals/eval-config.json");

const expectedFailureSchema = z
  .object({
    reason: z.string().min(1),
    scenario: z.string().min(1),
  })
  .strict();

const suiteEvaluationPolicySchema = z
  .object({
    expectedFailures: z.array(expectedFailureSchema),
    minimumPassRate: z.number().min(0).max(1),
    mustPassScenarios: z.array(z.string().min(1)),
  })
  .strict();

const modelPricingSchema = z
  .object({
    inputUsdPerMillionTokens: z.number().nonnegative(),
    outputUsdPerMillionTokens: z.number().nonnegative(),
  })
  .strict();

const onlineEvaluationPolicySchema = suiteEvaluationPolicySchema
  .extend({
    maxScenarios: z.number().int().positive(),
    spend: z
      .object({
        maxUsd: z.number().positive(),
        pricing: z.record(z.string().min(1), modelPricingSchema),
        pricingSource: z.url(),
      })
      .strict(),
  })
  .strict();

const evaluationConfigSchema = z
  .object({
    offline: suiteEvaluationPolicySchema,
    online: onlineEvaluationPolicySchema,
  })
  .strict() satisfies z.ZodType<EvaluationConfig>;

export async function loadEvaluationConfig(): Promise<EvaluationConfig> {
  const contents = await readFile(configPath, "utf8");
  const parsedConfig = evaluationConfigSchema.safeParse(JSON.parse(contents));

  if (!parsedConfig.success) {
    throw new Error(
      `Invalid evaluation config in ${configPath}:\n${z.prettifyError(parsedConfig.error)}`,
    );
  }

  return parsedConfig.data;
}
