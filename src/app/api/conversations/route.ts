import { NextResponse } from "next/server";

import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import {
  parseConversationSummaryQuery,
  parseMessageRequest,
} from "@/app/api/conversation-request";
import {
  createRequestId,
  jsonChatResponse,
  jsonError,
  unexpectedServerError,
} from "@/app/api/http-errors";
import { MESSAGE_CONTENT_MAX_LENGTH } from "@/domain/conversations/constants";
import type { ConversationSummary } from "@/domain/conversations/types";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const query = parseConversationSummaryQuery(request);

  if (query === null) {
    return jsonError(
      "INVALID_PAGINATION",
      "The conversation list parameters are invalid.",
      422,
      requestId,
      false,
    );
  }

  try {
    const { conversationRepository } = getConversationApiDependencies();
    const summaries: ConversationSummary[] =
      await conversationRepository.listConversationSummaries(query);

    return NextResponse.json(summaries);
  } catch {
    return jsonError(
      "PERSISTENCE_UNAVAILABLE",
      "Conversation storage is unavailable. Please retry.",
      503,
      requestId,
      true,
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = createRequestId();
  const input = await parseMessageRequest(request);

  if (input === null) {
    return jsonError(
      "INVALID_MESSAGE",
      `Message content must be between 1 and ${MESSAGE_CONTENT_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      422,
      requestId,
      false,
    );
  }

  try {
    const { chatService } = getConversationApiDependencies();
    const response = await chatService.startConversation({
      ...input,
      requestId,
    });

    return jsonChatResponse(response, 201, requestId);
  } catch {
    return unexpectedServerError(requestId);
  }
}
