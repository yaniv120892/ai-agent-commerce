import { describe, expect, it } from "vitest";

import type { ChatResponse } from "@/domain/chat/types";

import { jsonChatResponse } from "./http-errors";

const assistantMessage = {
  content: "",
  createdAt: "2026-07-17T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000002",
  productCards: [],
  role: "assistant" as const,
  status: "failed" as const,
};

function createErrorResponse(
  code: "MODEL_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE",
): ChatResponse {
  return {
    assistantMessage,
    conversationId: "00000000-0000-4000-8000-000000000001",
    error: {
      code,
      message: "Please retry.",
    },
    status: "error",
  };
}

describe("jsonChatResponse", () => {
  it("preserves the persisted conversation ID only for a recoverable persistence error", async () => {
    const response = jsonChatResponse(
      createErrorResponse("PERSISTENCE_UNAVAILABLE"),
      201,
      "request-id",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      conversationId: "00000000-0000-4000-8000-000000000001",
      error: {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "Please retry.",
      },
    });
  });

  it("does not mark arbitrary chat errors as recoverable conversation retries", async () => {
    const response = jsonChatResponse(
      createErrorResponse("MODEL_UNAVAILABLE"),
      201,
      "request-id",
    );

    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MODEL_UNAVAILABLE",
        message: "Please retry.",
      },
    });
  });
});
