import { describe, expect, it, vi } from "vitest";

import { ConversationRepository } from "./conversation-repository";

describe("ConversationRepository", () => {
  it("completes only the targeted pending assistant message and stores cards by input order", async () => {
    const message = {
      findUnique: vi.fn().mockResolvedValue({
        id: "assistant-message-id",
        role: "assistant",
        content: "Here are two options.",
        status: "complete",
        createdAt: new Date("2026-07-16T10:00:00.000Z"),
        productCards: [],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const messageProductCard = {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const conversation = {
      update: vi.fn().mockResolvedValue(undefined),
    };
    const transactionClient = {
      conversation,
      message,
      messageProductCard,
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation(async (callback) => callback(transactionClient)),
    };
    const repository = new ConversationRepository(prisma as never);

    await repository.completeAssistantMessage({
      conversationId: "conversation-id",
      messageId: "assistant-message-id",
      content: "Here are two options.",
      productCards: [
        {
          productId: 101,
          title: "First product",
          shortDescription: "First description",
          price: 12.5,
          imageUrl: "https://example.test/first.png",
          category: "first",
          rating: 4.5,
        },
        {
          productId: 202,
          title: "Second product",
          shortDescription: "Second description",
          price: 24.75,
          imageUrl: "https://example.test/second.png",
          category: "second",
          rating: null,
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(message.updateMany).toHaveBeenCalledWith({
      data: {
        content: "Here are two options.",
        status: "complete",
      },
      where: {
        conversationId: "conversation-id",
        id: "assistant-message-id",
        role: "assistant",
        status: "pending",
      },
    });
    expect(messageProductCard.createMany).toHaveBeenCalledWith({
      data: [
        {
          category: "first",
          imageUrl: "https://example.test/first.png",
          messageId: "assistant-message-id",
          position: 0,
          price: 12.5,
          productId: 101,
          rating: 4.5,
          shortDescription: "First description",
          title: "First product",
        },
        {
          category: "second",
          imageUrl: "https://example.test/second.png",
          messageId: "assistant-message-id",
          position: 1,
          price: 24.75,
          productId: 202,
          rating: null,
          shortDescription: "Second description",
          title: "Second product",
        },
      ],
    });
  });
});
