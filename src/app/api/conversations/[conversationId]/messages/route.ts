import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import {
  parseConversationId,
  parseMessageRequest,
} from "@/app/api/conversation-request";
import {
  jsonChatResponse,
  jsonError,
  unexpectedServerError,
} from "@/app/api/http-errors";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const { conversationId: rawConversationId } = await context.params;
  const conversationId = parseConversationId(rawConversationId);

  if (conversationId === null) {
    return jsonError(
      "INVALID_CONVERSATION_ID",
      "The conversation identifier is invalid.",
      422,
      requestId,
    );
  }

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
    const response = await chatService.appendMessage({
      ...input,
      conversationId,
    });

    return jsonChatResponse(response, 200, requestId);
  } catch {
    return unexpectedServerError(requestId);
  }
}
