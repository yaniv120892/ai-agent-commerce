import { beforeEach, describe, expect, it } from "vitest";

import { ConversationRepository } from "@/domain/conversations/conversation-repository";
import { prisma } from "@/lib/db/prisma";

const repository = new ConversationRepository(prisma);

describe("ConversationRepository", () => {
  beforeEach(async () => {
    await prisma.messageProductCard.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
  });

  it("resumes messages and snapshot cards in stored order", async () => {
    const conversation = await repository.createConversationWithPendingReply({
      clientRequestId: "00000000-0000-4000-8000-000000000001",
      content: "I need a desk chair.",
      title: "Desk chairs",
    });
    const assistantMessage = conversation.messages[1];

    await repository.completeAssistantMessage({
      content: "These two chairs fit your request.",
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      productCards: [
        {
          category: "furniture",
          imageUrl: "https://example.test/first-chair.png",
          price: 119.99,
          productId: 10,
          rating: 4.25,
          shortDescription: "A first chair.",
          title: "First chair",
        },
        {
          category: "furniture",
          imageUrl: "https://example.test/second-chair.png",
          price: 89.5,
          productId: 20,
          rating: null,
          shortDescription: "A second chair.",
          title: "Second chair",
        },
      ],
    });

    const resumedConversation = await repository.getConversation(
      conversation.id,
    );

    expect(resumedConversation).not.toBeNull();
    expect(
      resumedConversation?.messages.map((message) => message.role),
    ).toEqual(["user", "assistant"]);
    expect(resumedConversation?.messages[1]?.productCards).toEqual([
      {
        category: "furniture",
        imageUrl: "https://example.test/first-chair.png",
        price: 119.99,
        productId: 10,
        rating: 4.25,
        shortDescription: "A first chair.",
        title: "First chair",
      },
      {
        category: "furniture",
        imageUrl: "https://example.test/second-chair.png",
        price: 89.5,
        productId: 20,
        rating: null,
        shortDescription: "A second chair.",
        title: "Second chair",
      },
    ]);
  });

  it("does not duplicate a user message when the same request ID is retried", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        title: "Retry test",
      },
    });
    const request = {
      clientRequestId: "00000000-0000-4000-8000-000000000002",
      content: "Show me headphones.",
      conversationId: conversation.id,
    };

    const firstAssistantMessage =
      await repository.appendMessageWithPendingReply(request);
    const retriedAssistantMessage =
      await repository.appendMessageWithPendingReply(request);
    const messages = await prisma.message.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        conversationId: conversation.id,
      },
    });

    expect(retriedAssistantMessage.id).toBe(firstAssistantMessage.id);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(
      messages.filter(
        (message) => message.clientRequestId === request.clientRequestId,
      ),
    ).toHaveLength(1);
  });
});
