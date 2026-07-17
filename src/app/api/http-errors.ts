import { NextResponse } from "next/server";

import type { ChatErrorCode, ChatResponse } from "@/domain/chat/types";

type ErrorResponse = {
  conversationId?: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

const statusByChatErrorCode: Record<ChatErrorCode, number> = {
  CATALOG_UNAVAILABLE: 502,
  INVALID_MESSAGE: 422,
  INVALID_RETRIEVAL_PLAN: 422,
  MODEL_AUTH_FAILED: 503,
  MODEL_RATE_LIMITED: 429,
  MODEL_REFUSED: 422,
  MODEL_TIMEOUT: 504,
  MODEL_UNAVAILABLE: 503,
  PERSISTENCE_UNAVAILABLE: 503,
  UNKNOWN_CONVERSATION: 404,
};

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  requestId: string,
  retryable: boolean,
  conversationId?: string,
): NextResponse<ErrorResponse> {
  console.error("Conversation API request failed", {
    code,
    requestId,
    retryable,
  });

  return NextResponse.json(
    {
      ...(conversationId === undefined ? {} : { conversationId }),
      error: { code, message, retryable },
    },
    { status },
  );
}

export function jsonChatResponse(
  response: ChatResponse,
  successStatus: number,
  requestId: string,
): NextResponse<ChatResponse | ErrorResponse> {
  if (response.status !== "error") {
    return NextResponse.json(response, { status: successStatus });
  }

  return jsonError(
    response.error.code,
    response.error.message,
    statusByChatErrorCode[response.error.code],
    requestId,
    response.error.retryable,
    response.error.code === "PERSISTENCE_UNAVAILABLE"
      ? (response.conversationId ?? undefined)
      : undefined,
  );
}

export function unexpectedServerError(
  requestId: string,
): NextResponse<ErrorResponse> {
  return jsonError(
    "INTERNAL_SERVER_ERROR",
    "An unexpected error occurred. Please retry.",
    500,
    requestId,
    true,
  );
}
