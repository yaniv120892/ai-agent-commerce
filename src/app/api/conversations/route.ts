import { NextResponse } from "next/server";

import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import {
  parseConversationSummaryQuery,
  parseMessageRequest,
} from "@/app/api/conversation-request";
import {
  jsonChatResponse,
  jsonError,
  unexpectedServerError,
} from "@/app/api/http-errors";
import type { ConversationSummary } from "@/domain/conversations/types";

function createRequestId(): string {
  return crypto.randomUUID();
}

export async function GET(request: Request) {
  const requestId = createRequestId();
  const query = parseConversationSummaryQuery(request);

  if (query === null) {
    return jsonError(
      "INVALID_PAGINATION",
      "The conversation list parameters are invalid.",
      422,
      requestId,
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
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = createRequestId();
  const input = await parseMessageRequest(request);

  if (input === null) {
    return jsonError(
      "INVALID_MESSAGE",
      "Message content must be between 1 and 2,000 characters.",
      422,
      requestId,
    );
  }

  try {
    const { chatService } = getConversationApiDependencies();
    const response = await chatService.startConversation(input);

    return jsonChatResponse(response, 201, requestId);
  } catch {
    return unexpectedServerError(requestId);
  }
}
