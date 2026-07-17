import { NextResponse } from "next/server";

import type { ChatErrorCode, ChatResponse } from "@/domain/chat/types";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

const statusByChatErrorCode: Record<ChatErrorCode, number> = {
  CATALOG_UNAVAILABLE: 502,
  INVALID_MESSAGE: 422,
  INVALID_RETRIEVAL_PLAN: 422,
  MODEL_UNAVAILABLE: 503,
  PERSISTENCE_UNAVAILABLE: 503,
  UNKNOWN_CONVERSATION: 404,
};

export function jsonError(
  code: string,
  message: string,
  status: number,
  requestId: string,
): NextResponse<ErrorResponse> {
  console.error("Conversation API request failed", { code, requestId });

  return NextResponse.json({ error: { code, message } }, { status });
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
  );
}
