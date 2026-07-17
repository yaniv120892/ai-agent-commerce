import { z } from "zod";

const messageRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    content: z.string(),
  })
  .strict();

const conversationIdSchema = z.uuid();

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
