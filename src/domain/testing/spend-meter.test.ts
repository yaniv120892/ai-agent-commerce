import { describe, expect, it, vi } from "vitest";

import type { ModelPricing } from "./evaluation-config.types";
import { SpendMeter } from "./spend-meter";

const pricing: Record<string, ModelPricing> = {
  "gpt-5.4": { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 15 },
  "gpt-5.4-mini": {
    inputUsdPerMillionTokens: 0.75,
    outputUsdPerMillionTokens: 4.5,
  },
};

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("SpendMeter", () => {
  it("converts token usage to USD using the committed rates", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({
        model: "gpt-5.4-mini",
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      }),
    );

    await meter.createFetch()("https://api.openai.com/v1/responses");

    expect(meter.snapshot.totalUsd).toBeCloseTo(5.25, 10);
    expect(meter.snapshot.requestCount).toBe(1);
  });

  it("accumulates spend across requests", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({
        model: "gpt-5.4-mini",
        usage: { input_tokens: 1000, output_tokens: 100 },
      }),
    );
    const meteredFetch = meter.createFetch();

    await meteredFetch("https://api.openai.com/v1/responses");
    await meteredFetch("https://api.openai.com/v1/responses");

    expect(meter.snapshot.totalUsd).toBeCloseTo(0.0024, 10);
    expect(meter.snapshot.requestCount).toBe(2);
  });

  it("prices a dated model snapshot using the longest matching key", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({
        model: "gpt-5.4-mini-2026-07-01",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      }),
    );

    await meter.createFetch()("https://api.openai.com/v1/responses");

    expect(meter.snapshot.totalUsd).toBeCloseTo(0.75, 10);
    expect(meter.snapshot.unpricedModels).toEqual([]);
  });

  it("returns the response body unconsumed to the caller", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({
        model: "gpt-5.4-mini",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const response = await meter.createFetch()(
      "https://api.openai.com/v1/responses",
    );
    const body: unknown = await response.json();

    expect(body).toMatchObject({ model: "gpt-5.4-mini" });
  });

  it("records a missing usage block instead of silently charging zero", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({ model: "gpt-5.4-mini" }),
    );

    await meter.createFetch()("https://api.openai.com/v1/responses");

    expect(meter.snapshot.usageMissingCount).toBe(1);
    expect(meter.snapshot.totalUsd).toBe(0);
  });

  it("records an unpriced model rather than charging zero", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({
        model: "some-future-model",
        usage: { input_tokens: 1000, output_tokens: 1000 },
      }),
    );

    await meter.createFetch()("https://api.openai.com/v1/responses");

    expect(meter.snapshot.unpricedModels).toEqual(["some-future-model"]);
    expect(meter.snapshot.totalUsd).toBe(0);
  });

  it("meters each SDK retry separately, because each one is billed", async () => {
    const meter = new SpendMeter(pricing, async () =>
      createJsonResponse({
        model: "gpt-5.4-mini",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      }),
    );
    const meteredFetch = meter.createFetch();

    await meteredFetch("https://api.openai.com/v1/responses");
    await meteredFetch("https://api.openai.com/v1/responses");
    await meteredFetch("https://api.openai.com/v1/responses");

    expect(meter.snapshot.totalUsd).toBeCloseTo(2.25, 10);
  });

  it("ignores error responses", async () => {
    const meter = new SpendMeter(
      pricing,
      async () =>
        new Response("rate limited", {
          headers: { "content-type": "application/json" },
          status: 429,
        }),
    );

    await meter.createFetch()("https://api.openai.com/v1/responses");

    expect(meter.snapshot.requestCount).toBe(0);
    expect(meter.snapshot.totalUsd).toBe(0);
  });

  it("passes the request through to the underlying fetch untouched", async () => {
    const baseFetch = vi.fn(async () =>
      createJsonResponse({
        model: "gpt-5.4-mini",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const meter = new SpendMeter(pricing, baseFetch);

    await meter.createFetch()("https://api.openai.com/v1/responses", {
      method: "POST",
    });

    expect(baseFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      { method: "POST" },
    );
  });

  it("rejects a model with no committed pricing before any request is made", () => {
    const meter = new SpendMeter(pricing);

    expect(() => {
      meter.assertPricingExistsFor(["gpt-5.4-mini", "unpriced-model"]);
    }).toThrow(/No committed pricing for unpriced-model/u);
  });

  it("reports a repeated unpriced model once", () => {
    const meter = new SpendMeter(pricing);

    expect(() => {
      meter.assertPricingExistsFor(["unpriced-model", "unpriced-model"]);
    }).toThrow(/No committed pricing for unpriced-model \(/u);
  });

  it("accepts models that have committed pricing", () => {
    const meter = new SpendMeter(pricing);

    expect(() => {
      meter.assertPricingExistsFor(["gpt-5.4-mini", "gpt-5.4"]);
    }).not.toThrow();
  });
});
