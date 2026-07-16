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

    expect(retriedAssistantMessage.assistantMessage.id).toBe(
      firstAssistantMessage.assistantMessage.id,
    );
    expect(retriedAssistantMessage.state).toBe("existing");
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

  it("returns the assistant reply associated with the retried request", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        title: "Request association test",
      },
    });
    const firstRequest = {
      clientRequestId: "00000000-0000-4000-8000-000000000003",
      content: "Show me laptops.",
      conversationId: conversation.id,
    };
    const secondRequest = {
      clientRequestId: "00000000-0000-4000-8000-000000000004",
      content: "Show me cameras.",
      conversationId: conversation.id,
    };

    const firstAssistantMessage =
      await repository.appendMessageWithPendingReply(firstRequest);
    const secondAssistantMessage =
      await repository.appendMessageWithPendingReply(secondRequest);

    await prisma.message.update({
      data: {
        createdAt: new Date("2030-07-16T10:00:01.000Z"),
      },
      where: {
        id: secondAssistantMessage.assistantMessage.id,
      },
    });

    const retriedAssistantMessage =
      await repository.appendMessageWithPendingReply(firstRequest);

    expect(retriedAssistantMessage.assistantMessage.id).toBe(
      firstAssistantMessage.assistantMessage.id,
    );
  });

  it("returns one assistant reply when concurrent retries use one request ID", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        title: "Concurrent retry test",
      },
    });
    const request = {
      clientRequestId: "00000000-0000-4000-8000-000000000005",
      content: "Show me monitors.",
      conversationId: conversation.id,
    };

    const [firstAssistantMessage, secondAssistantMessage] = await Promise.all([
      repository.appendMessageWithPendingReply(request),
      repository.appendMessageWithPendingReply(request),
    ]);
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
      },
    });

    expect(secondAssistantMessage.assistantMessage.id).toBe(
      firstAssistantMessage.assistantMessage.id,
    );
    expect(messages).toHaveLength(2);
  });

  it("atomically resets a failed request-linked reply to pending for one retry", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        title: "Failed retry test",
      },
    });
    const request = {
      clientRequestId: "00000000-0000-4000-8000-000000000008",
      content: "Show me keyboards.",
      conversationId: conversation.id,
    };
    const firstReply = await repository.appendMessageWithPendingReply(request);

    await repository.failAssistantMessage({
      conversationId: conversation.id,
      messageId: firstReply.assistantMessage.id,
    });

    const retriedReply =
      await repository.appendMessageWithPendingReply(request);
    const messages = await prisma.message.findMany({
      orderBy: {
        sequence: "asc",
      },
      where: {
        conversationId: conversation.id,
      },
    });

    expect(retriedReply).toMatchObject({
      assistantMessage: {
        id: firstReply.assistantMessage.id,
        status: "pending",
      },
      state: "retried",
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: firstReply.assistantMessage.id,
      status: "pending",
    });
  });

  it("orders initial user and assistant messages by stored sequence", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        title: "Sequence test",
      },
    });
    const timestamp = new Date("2026-07-16T10:00:00.000Z");

    await prisma.$executeRaw`
      INSERT INTO messages (
        id,
        conversation_id,
        role,
        content,
        status,
        created_at,
        sequence
      )
      VALUES (
        '00000000-0000-4000-8000-000000000007'::uuid,
        ${conversation.id}::uuid,
        'assistant'::"MessageRole",
        '',
        'pending'::"MessageStatus",
        ${timestamp},
        1
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO messages (
        id,
        conversation_id,
        role,
        content,
        status,
        created_at,
        sequence
      )
      VALUES (
        '00000000-0000-4000-8000-000000000006'::uuid,
        ${conversation.id}::uuid,
        'user'::"MessageRole",
        'Initial question',
        'complete'::"MessageStatus",
        ${timestamp},
        0
      )
    `;

    const resumedConversation = await repository.getConversation(
      conversation.id,
    );

    expect(
      resumedConversation?.messages.map((message) => message.role),
    ).toEqual(["user", "assistant"]);
  });
});
