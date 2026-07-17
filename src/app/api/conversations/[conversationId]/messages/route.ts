import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import {
  parseConversationId,
  parseMessageRequest,
} from "@/app/api/conversation-request";
import {
  createRequestId,
  jsonChatResponse,
  jsonError,
  unexpectedServerError,
} from "@/app/api/http-errors";
import { MESSAGE_CONTENT_MAX_LENGTH } from "@/domain/conversations/constants";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
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
    const response = await chatService.appendMessage({
      ...input,
      conversationId,
      requestId,
    });

    return jsonChatResponse(response, 200, requestId);
  } catch {
    return unexpectedServerError(requestId);
  }
}
