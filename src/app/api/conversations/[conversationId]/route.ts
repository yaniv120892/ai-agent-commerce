import { NextResponse } from "next/server";

import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import { parseConversationId } from "@/app/api/conversation-request";
import { createRequestId, jsonError } from "@/app/api/http-errors";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const { conversationId: rawConversationId } = await context.params;
  const conversationId = parseConversationId(rawConversationId);

  if (conversationId === null) {
    return jsonError(
      "INVALID_CONVERSATION_ID",
      "The conversation identifier is invalid.",
      422,
      requestId,
      false,
    );
  }

  try {
    const { conversationRepository } = getConversationApiDependencies();
    const conversation =
      await conversationRepository.getConversation(conversationId);

    if (conversation === null) {
      return jsonError(
        "UNKNOWN_CONVERSATION",
        "This conversation is no longer available.",
        404,
        requestId,
        false,
      );
    }

    return NextResponse.json(conversation);
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
