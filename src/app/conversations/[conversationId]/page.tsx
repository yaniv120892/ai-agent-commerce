import { notFound } from "next/navigation";

import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import { ChatShell } from "@/components/chat/chat-shell";

type ConversationPageProperties = {
  params: Promise<{ conversationId: string }>;
};

export default async function ConversationPage({
  params,
}: ConversationPageProperties) {
  const { conversationId } = await params;
  const { conversationRepository } = getConversationApiDependencies();
  const conversation =
    await conversationRepository.getConversation(conversationId);

  if (conversation === null) {
    notFound();
  }

  return <ChatShell initialConversation={conversation} />;
}
