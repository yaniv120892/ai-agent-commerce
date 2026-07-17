import { z } from "zod";

import { MESSAGE_CONTENT_MAX_LENGTH } from "@/domain/conversations/constants";
import type { ConversationSummaryQuery } from "@/domain/conversations/types";

const messageRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    content: z.string().trim().min(1).max(MESSAGE_CONTENT_MAX_LENGTH),
  })
  .strict();

const conversationIdSchema = z.uuid();

const conversationSummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type MessageRequest = z.infer<typeof messageRequestSchema>;

export async function parseMessageRequest(
  request: Request,
): Promise<MessageRequest | null> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return null;
  }

  const parsedRequest = messageRequestSchema.safeParse(payload);

  return parsedRequest.success ? parsedRequest.data : null;
}

export function parseConversationId(conversationId: string): string | null {
  const parsedConversationId = conversationIdSchema.safeParse(conversationId);

  return parsedConversationId.success ? parsedConversationId.data : null;
}

export function parseConversationSummaryQuery(
  request: Request,
): ConversationSummaryQuery | null {
  const url = new URL(request.url);
  const parsedQuery = conversationSummaryQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });

  return parsedQuery.success ? parsedQuery.data : null;
}
