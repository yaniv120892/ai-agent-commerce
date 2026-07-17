import { describe, expect, it, vi } from "vitest";

import { ConversationRepository } from "./conversation-repository";

describe("ConversationRepository", () => {
  it("returns the persisted user content when retrying a failed request", async () => {
    const failedAssistantMessage = {
      content: "",
      createdAt: new Date("2026-07-16T10:00:00.000Z"),
      id: "assistant-message-id",
      productCards: [],
      role: "assistant",
      status: "failed",
    };
    const message = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({
          assistantReply: failedAssistantMessage,
          content: "Original saved request",
        })
        .mockResolvedValueOnce({
          assistantReply: {
            ...failedAssistantMessage,
            status: "pending",
          },
          content: "Original saved request",
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation(async (callback) => callback({ message })),
      message,
    };
    const repository = new ConversationRepository(prisma as never);

    const result = await repository.appendMessageWithPendingReply({
      clientRequestId: "request-id",
      content: "Changed retry body",
      conversationId: "conversation-id",
    });

    expect(result).toMatchObject({
      state: "retried",
      userMessageContent: "Original saved request",
    });
  });

  it("identifies an existing pending request-linked assistant reply without changing it", async () => {
    const pendingAssistantMessage = {
      content: "",
      createdAt: new Date("2026-07-16T10:00:00.000Z"),
      id: "assistant-message-id",
      productCards: [],
      role: "assistant",
      status: "pending",
    };
    const message = {
      findUnique: vi.fn().mockResolvedValue({
        assistantReply: pendingAssistantMessage,
      }),
      updateMany: vi.fn(),
    };
    const prisma = { message };
    const repository = new ConversationRepository(prisma as never);

    const result = await repository.appendMessageWithPendingReply({
      clientRequestId: "request-id",
      content: "Find me a phone",
      conversationId: "conversation-id",
    });

    expect(result).toMatchObject({
      assistantMessage: { id: "assistant-message-id", status: "pending" },
      state: "existing",
    });
    expect(message.updateMany).not.toHaveBeenCalled();
  });

  it("atomically retries a failed request-linked assistant reply", async () => {
    const failedAssistantMessage = {
      content: "",
      createdAt: new Date("2026-07-16T10:00:00.000Z"),
      id: "assistant-message-id",
      productCards: [],
      role: "assistant",
      status: "failed",
    };
    const retriedAssistantMessage = {
      ...failedAssistantMessage,
      status: "pending",
    };
    const message = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({ assistantReply: failedAssistantMessage })
        .mockResolvedValueOnce({ assistantReply: retriedAssistantMessage }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation(async (callback) => callback({ message })),
      message,
    };
    const repository = new ConversationRepository(prisma as never);

    const result = await repository.appendMessageWithPendingReply({
      clientRequestId: "request-id",
      content: "Find me a phone",
      conversationId: "conversation-id",
    });

    expect(result).toMatchObject({
      assistantMessage: { id: "assistant-message-id", status: "pending" },
      state: "retried",
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(message.updateMany).toHaveBeenCalledWith({
      data: {
        content: "",
        status: "pending",
      },
      where: {
        conversationId: "conversation-id",
        id: "assistant-message-id",
        role: "assistant",
        status: "failed",
      },
    });
  });

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
      lastCategorySlug: null,
      lastSearchTerms: ["first", "second"],
      retrievalAnchorMessage: "Show me two options",
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
        lastCategorySlug: null,
        lastSearchTerms: ["first", "second"],
        retrievalAnchorMessage: "Show me two options",
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
