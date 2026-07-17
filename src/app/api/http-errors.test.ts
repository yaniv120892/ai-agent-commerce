import { describe, expect, it } from "vitest";

import type { ChatErrorCode, ChatResponse } from "@/domain/chat/types";

import { jsonChatResponse } from "./http-errors";

const assistantMessage = {
  content: "",
  createdAt: "2026-07-17T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000002",
  lastCategorySlug: null,
  lastSearchTerms: [],
  productCards: [],
  retrievalAnchorMessage: null,
  role: "assistant" as const,
  status: "failed" as const,
};

function createErrorResponse(
  code: ChatErrorCode,
  retryable: boolean,
): ChatResponse {
  return {
    assistantMessage,
    conversationId: "00000000-0000-4000-8000-000000000001",
    error: {
      code,
      message: "Please retry.",
      retryable,
    },
    status: "error",
  };
}

describe("jsonChatResponse", () => {
  it("preserves the persisted conversation ID only for a recoverable persistence error", async () => {
    const response = jsonChatResponse(
      createErrorResponse("PERSISTENCE_UNAVAILABLE", true),
      201,
      "request-id",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      conversationId: "00000000-0000-4000-8000-000000000001",
      error: {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "Please retry.",
        retryable: true,
      },
    });
  });

  it("does not mark arbitrary chat errors as recoverable conversation retries", async () => {
    const response = jsonChatResponse(
      createErrorResponse("MODEL_UNAVAILABLE", true),
      201,
      "request-id",
    );

    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MODEL_UNAVAILABLE",
        message: "Please retry.",
        retryable: true,
      },
    });
  });

  it.each([
    ["MODEL_AUTH_FAILED", false, 503],
    ["MODEL_RATE_LIMITED", true, 429],
    ["MODEL_REFUSED", false, 422],
    ["MODEL_TIMEOUT", true, 504],
  ] as const)(
    "maps %s (retryable=%s) to status %i",
    async (code, retryable, expectedStatus) => {
      const response = jsonChatResponse(
        createErrorResponse(code, retryable),
        201,
        "request-id",
      );

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({
        error: {
          code,
          message: "Please retry.",
          retryable,
        },
      });
    },
  );
});
