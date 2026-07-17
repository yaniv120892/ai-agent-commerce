import { z } from "zod";

import type { ModelPricing } from "./evaluation-config.types";
import type { MeteredFetch, SpendSnapshot } from "./spend-meter.types";

export type { MeteredFetch, SpendSnapshot } from "./spend-meter.types";

const meteredResponseSchema = z
  .object({
    model: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().nonnegative(),
        output_tokens: z.number().nonnegative(),
      })
      .loose()
      .optional(),
  })
  .loose();

export class SpendMeter {
  private requestCount = 0;
  private totalUsdSpent = 0;
  private usageMissingCount = 0;
  private readonly unpricedModels = new Set<string>();

  public constructor(
    private readonly pricing: Record<string, ModelPricing>,
    private readonly baseFetch: MeteredFetch = fetch,
  ) {}

  public assertPricingExistsFor(modelIds: string[]): void {
    const unpriced = [...new Set(modelIds)].filter(
      (modelId) => this.findPricing(modelId) === null,
    );

    if (unpriced.length > 0) {
      throw new Error(
        `No committed pricing for ${unpriced.join(", ")} (priced: ${Object.keys(this.pricing).join(", ")}). Add it to tests/evals/eval-config.json before running the online evaluation.`,
      );
    }
  }

  // The OpenAI SDK turns a thrown fetch into a retried APIConnectionError, so
  // this only ever accounts. Enforcing the cap is the eval loop's job.
  public createFetch(): MeteredFetch {
    return async (input, init) => {
      const response = await this.baseFetch(input, init);

      await this.recordUsage(response);

      return response;
    };
  }

  public get snapshot(): SpendSnapshot {
    return {
      requestCount: this.requestCount,
      totalUsd: this.totalUsdSpent,
      unpricedModels: [...this.unpricedModels],
      usageMissingCount: this.usageMissingCount,
    };
  }

  private async recordUsage(response: Response): Promise<void> {
    if (!response.ok) {
      return;
    }

    if (
      response.headers.get("content-type")?.includes("application/json") !==
      true
    ) {
      return;
    }

    this.requestCount += 1;

    const body: unknown = await response.clone().json();
    const meteredResponse = meteredResponseSchema.safeParse(body);

    if (!meteredResponse.success || meteredResponse.data.usage === undefined) {
      this.usageMissingCount += 1;

      return;
    }

    const modelId = meteredResponse.data.model ?? "";
    const pricing = this.findPricing(modelId);

    if (pricing === null) {
      this.unpricedModels.add(modelId);

      return;
    }

    const { input_tokens: inputTokens, output_tokens: outputTokens } =
      meteredResponse.data.usage;

    this.totalUsdSpent +=
      (inputTokens * pricing.inputUsdPerMillionTokens) / 1_000_000 +
      (outputTokens * pricing.outputUsdPerMillionTokens) / 1_000_000;
  }

  // The API answers a request for "gpt-5.4-mini" with a dated snapshot such as
  // "gpt-5.4-mini-2026-07-01", so fall back to the longest committed key that
  // prefixes it rather than treating the snapshot as an unknown model.
  private findPricing(modelId: string): ModelPricing | null {
    const exactPricing = this.pricing[modelId];

    if (exactPricing !== undefined) {
      return exactPricing;
    }

    const matchingKeys = Object.keys(this.pricing)
      .filter((key) => modelId.startsWith(key))
      .sort((first, second) => second.length - first.length);
    const bestKey = matchingKeys[0];

    if (bestKey === undefined) {
      return null;
    }

    return this.pricing[bestKey] ?? null;
  }
}
