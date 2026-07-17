// @vitest-environment node

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import { describe, expect, it, vi } from "vitest";

import type { RetrievalPlan } from "@/domain/catalog/types";
import type { ProductCardSnapshot } from "@/domain/conversations/types";

import { OpenAIModelClient } from "./openai-model-client";
import type { ModelErrorCode } from "./types";

const modelClientConfig = {
  apiKey: "test-key",
  maxOutputTokens: 2000,
  maxRetries: 1,
  models: { plannerModel: "planner-model", replyModel: "reply-model" },
  timeoutMs: 20000,
};

const planInput = {
  activeContext: null,
  allowedCategorySlugs: ["smartphones"],
  history: [],
  priorProductIds: [],
  userMessage: "Find a phone",
};

const productCards: ProductCardSnapshot[] = [
  {
    category: "smartphones",
    imageUrl: "https://example.test/phone.png",
    price: 399,
    productId: 101,
    rating: 4.8,
    shortDescription: "A trusted catalog phone",
    title: "Phone Ultra",
  },
];

const replyInput = {
  intent: "search" as RetrievalPlan["intent"],
  products: productCards,
  userMessage: "Find a phone",
};

function createClient(parse: ReturnType<typeof vi.fn>) {
  return new OpenAIModelClient(modelClientConfig, {
    responses: { create: vi.fn(), parse },
  });
}

async function expectModelErrorCode(
  rejection: Promise<unknown>,
  code: ModelErrorCode,
): Promise<void> {
  await expect(rejection).rejects.toMatchObject({
    code,
    name: "ModelError",
  });
}

describe("OpenAIModelClient error classification", () => {
  it("classifies a 401 as AUTH_FAILED", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(
        new APIError(401, {}, "Invalid API key", new Headers()),
      );
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "AUTH_FAILED",
    );
  });

  it("classifies a 403 as AUTH_FAILED", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(
        new APIError(403, {}, "Permission denied", new Headers()),
      );
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "AUTH_FAILED",
    );
  });

  it("classifies a 429 as RATE_LIMITED", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(
        new APIError(429, {}, "Too many requests", new Headers()),
      );
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "RATE_LIMITED",
    );
  });

  it("classifies any other API status as UNAVAILABLE", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(
        new APIError(500, {}, "Internal server error", new Headers()),
      );
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "UNAVAILABLE",
    );
  });

  it("classifies a connection timeout as TIMEOUT", async () => {
    const parse = vi.fn().mockRejectedValue(new APIConnectionTimeoutError());
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "TIMEOUT",
    );
  });

  it("classifies a user abort as TIMEOUT", async () => {
    const parse = vi.fn().mockRejectedValue(new APIUserAbortError());
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "TIMEOUT",
    );
  });

  it("classifies a connection error as UNAVAILABLE", async () => {
    const parse = vi.fn().mockRejectedValue(new APIConnectionError({}));
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "UNAVAILABLE",
    );
  });

  it("classifies an unrecognized throw as UNAVAILABLE", async () => {
    const parse = vi.fn().mockRejectedValue("boom");
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "UNAVAILABLE",
    );
  });

  it("classifies an incomplete_details content_filter reason as REFUSED", async () => {
    const parse = vi.fn().mockResolvedValue({
      incomplete_details: { reason: "content_filter" },
      output: [],
      output_parsed: null,
    });
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "REFUSED",
    );
  });

  it("classifies a refusal output item as REFUSED", async () => {
    const parse = vi.fn().mockResolvedValue({
      incomplete_details: null,
      output: [
        {
          content: [{ refusal: "I can't help with that.", type: "refusal" }],
          type: "message",
        },
      ],
      output_parsed: null,
    });
    const client = createClient(parse);

    await expectModelErrorCode(
      client.createRetrievalPlan(planInput),
      "REFUSED",
    );
  });

  it("classifies a refusal on the grounded-reply path as REFUSED", async () => {
    const create = vi.fn().mockResolvedValue({
      incomplete_details: { reason: "content_filter" },
      output: [],
      output_text: "",
    });
    const client = new OpenAIModelClient(modelClientConfig, {
      responses: { create, parse: vi.fn() },
    });

    await expectModelErrorCode(
      client.createGroundedReply(replyInput),
      "REFUSED",
    );
  });
});
