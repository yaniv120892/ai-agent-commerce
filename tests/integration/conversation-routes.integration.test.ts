import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlanValidator } from "@/domain/catalog/plan-validator";
import type { RetrievalPlan } from "@/domain/catalog/types";
import { ChatService } from "@/domain/chat/chat-service";
import { PlanRepairService } from "@/domain/chat/plan-repair-service";
import { RedisReplyCompletionCache } from "@/domain/chat/redis-reply-completion-cache";
import type { ModelClient } from "@/domain/chat/types";
import { ConversationRepository } from "@/domain/conversations/conversation-repository";
import type { ProductCardSnapshot } from "@/domain/conversations/types";
import { prisma } from "@/lib/db/prisma";
import { redisClient } from "@/lib/redis/redis-client";

vi.mock("@/app/api/conversation-dependencies", () => ({
  getConversationApiDependencies: vi.fn(),
}));

import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import { GET as getConversation } from "@/app/api/conversations/[conversationId]/route";
import { POST as appendMessage } from "@/app/api/conversations/[conversationId]/messages/route";
import { GET as listConversations } from "@/app/api/conversations/route";
import { POST as createConversation } from "@/app/api/conversations/route";

const productCards: ProductCardSnapshot[] = [
  {
    category: "smartphones",
    imageUrl: "https://example.test/phone-ultra.png",
    price: 399,
    productId: 101,
    rating: 4.8,
    shortDescription: "A phone from the trusted catalog.",
    title: "Phone Ultra",
  },
];

const retrievalPlan: RetrievalPlan = {
  assistantMessage: null,
  categorySlug: null,
  inStock: null,
  intent: "search",
  isContinuation: false,
  maxPrice: null,
  minRating: null,
  referencedProductIds: [],
  searchTerms: ["phone"],
  sort: "relevance",
};

describe("conversation routes", () => {
  const repository = new ConversationRepository(prisma);
  const catalogResolver = {
    listAllowedCategorySlugs: vi.fn().mockResolvedValue(["smartphones"]),
    resolve: vi.fn().mockResolvedValue({ productCards }),
  };
  const modelClient: ModelClient = {
    createGroundedReply: vi.fn().mockResolvedValue("Phone Ultra is a match."),
    createRetrievalPlan: vi.fn().mockResolvedValue(retrievalPlan),
  };
  const chatService = new ChatService(
    repository,
    catalogResolver,
    modelClient,
    new PlanRepairService(
      modelClient,
      (categorySlugs) => new PlanValidator(categorySlugs),
    ),
  );

  beforeEach(async () => {
    await prisma.messageProductCard.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    vi.clearAllMocks();
    vi.mocked(getConversationApiDependencies).mockReturnValue({
      chatService,
      conversationRepository: repository,
    });
  });

  it("creates a conversation and returns completed cards", async () => {
    const response = await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000101",
          content: "Show me a phone.",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      assistantMessage: {
        content: "Phone Ultra is a match.",
        productCards,
        status: "complete",
      },
      status: "complete",
    });
  });

  it("reuses the initial conversation and model result after its completion write fails", async () => {
    const completionFailure = vi
      .spyOn(repository, "completeAssistantMessage")
      .mockRejectedValueOnce(new Error("PostgreSQL write failed"));
    const request = {
      clientRequestId: "00000000-0000-4000-8000-000000000109",
      content: "Show me a phone.",
    };

    const failedResponse = await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(failedResponse.status).toBe(503);
    const failedPayload = await failedResponse.json();
    expect(failedPayload).toEqual({
      conversationId: expect.any(String),
      error: {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "Conversation storage is unavailable. Please retry.",
        retryable: true,
      },
    });

    const retryResponse = await appendMessage(
      new Request("http://localhost/api/conversations/messages", {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          conversationId: failedPayload.conversationId,
        }),
      },
    );

    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      conversationId: failedPayload.conversationId,
      status: "complete",
    });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
    expect(modelClient.createGroundedReply).toHaveBeenCalledOnce();
    expect(completionFailure).toHaveBeenCalledTimes(2);
    await expect(prisma.conversation.count()).resolves.toBe(1);
    await expect(
      prisma.message.count({
        where: {
          conversationId: failedPayload.conversationId,
        },
      }),
    ).resolves.toBe(2);
  });

  it("recovers a persistence failure on a different instance via the shared Redis-backed cache", async () => {
    const buildChatServiceInstance = () =>
      new ChatService(
        repository,
        catalogResolver,
        modelClient,
        new PlanRepairService(
          modelClient,
          (categorySlugs) => new PlanValidator(categorySlugs),
        ),
        new RedisReplyCompletionCache(redisClient, 300),
      );
    const instanceA = buildChatServiceInstance();
    const instanceB = buildChatServiceInstance();

    const completionFailure = vi
      .spyOn(repository, "completeAssistantMessage")
      .mockRejectedValueOnce(new Error("PostgreSQL write failed"));
    const request = {
      clientRequestId: "00000000-0000-4000-8000-000000000110",
      content: "Show me a phone.",
    };

    vi.mocked(getConversationApiDependencies).mockReturnValueOnce({
      chatService: instanceA,
      conversationRepository: repository,
    });
    const failedResponse = await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(failedResponse.status).toBe(503);
    const failedPayload = await failedResponse.json();

    vi.mocked(getConversationApiDependencies).mockReturnValueOnce({
      chatService: instanceB,
      conversationRepository: repository,
    });
    const retryResponse = await appendMessage(
      new Request("http://localhost/api/conversations/messages", {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          conversationId: failedPayload.conversationId,
        }),
      },
    );

    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      conversationId: failedPayload.conversationId,
      status: "complete",
    });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
    expect(modelClient.createGroundedReply).toHaveBeenCalledOnce();
    expect(completionFailure).toHaveBeenCalledTimes(2);
  });

  it("returns 404 when a cleared database no longer has the requested conversation", async () => {
    const response = await getConversation(new Request("http://localhost"), {
      params: Promise.resolve({
        conversationId: "00000000-0000-4000-8000-000000000102",
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNKNOWN_CONVERSATION",
        message: "This conversation is no longer available.",
        retryable: false,
      },
    });
  });

  it("lists conversation summaries without messages", async () => {
    await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000104",
          content: "Show me a phone.",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    const response = await listConversations(
      new Request("http://localhost/api/conversations?limit=1&offset=0"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        title: "Show me a phone.",
      }),
    ]);
  });

  it("appends a message and returns a completed reply", async () => {
    const createResponse = await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000105",
          content: "Show me a phone.",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const createPayload = await createResponse.json();
    const response = await appendMessage(
      new Request("http://localhost/api/conversations/messages", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000106",
          content: "Only under $500.",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          conversationId: createPayload.conversationId,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assistantMessage: {
        content: "Phone Ultra is a match.",
        status: "complete",
      },
      conversationId: createPayload.conversationId,
      status: "complete",
    });
  });

  it("carries a continuation's replay anchor across more than one consecutive 'more' request", async () => {
    const firstCards: ProductCardSnapshot[] = [
      { ...productCards[0], productId: 101 },
    ];
    const secondCards: ProductCardSnapshot[] = [
      { ...productCards[0], productId: 102 },
    ];
    const thirdCards: ProductCardSnapshot[] = [
      { ...productCards[0], productId: 103 },
    ];
    const continuationPlan: RetrievalPlan = {
      ...retrievalPlan,
      categorySlug: "smartphones",
      intent: "browse_category",
      isContinuation: true,
      searchTerms: [],
    };

    vi.mocked(modelClient.createRetrievalPlan)
      .mockResolvedValueOnce(retrievalPlan)
      .mockResolvedValueOnce(continuationPlan)
      .mockResolvedValueOnce(continuationPlan);
    catalogResolver.resolve
      .mockResolvedValueOnce({ productCards: firstCards })
      .mockResolvedValueOnce({ productCards: secondCards })
      .mockResolvedValueOnce({ productCards: thirdCards });

    const createResponse = await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000110",
          content: "Show me a phone.",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const createPayload = await createResponse.json();

    const secondResponse = await appendMessage(
      new Request("http://localhost/api/conversations/messages", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000111",
          content: "Show me more",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          conversationId: createPayload.conversationId,
        }),
      },
    );
    const secondPayload = await secondResponse.json();

    const thirdResponse = await appendMessage(
      new Request("http://localhost/api/conversations/messages", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000112",
          content: "Show me more",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          conversationId: createPayload.conversationId,
        }),
      },
    );
    const thirdPayload = await thirdResponse.json();

    expect(
      secondPayload.assistantMessage.productCards.map(
        (card: ProductCardSnapshot) => card.productId,
      ),
    ).toEqual([102]);
    expect(
      thirdPayload.assistantMessage.productCards.map(
        (card: ProductCardSnapshot) => card.productId,
      ),
    ).toEqual([103]);
    expect(modelClient.createRetrievalPlan).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        activeContext: expect.objectContaining({
          lastResolvedUserMessage: "Show me a phone.",
        }),
      }),
    );
  });

  it("returns 404 when appending to an unknown conversation", async () => {
    const response = await appendMessage(
      new Request("http://localhost/api/conversations/messages", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000107",
          content: "Show me a phone.",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          conversationId: "00000000-0000-4000-8000-000000000108",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNKNOWN_CONVERSATION",
        message: "This conversation is no longer available.",
        retryable: false,
      },
    });
  });

  it("returns 422 without calling the model for invalid message content", async () => {
    const response = await createConversation(
      new Request("http://localhost/api/conversations", {
        body: JSON.stringify({
          clientRequestId: "00000000-0000-4000-8000-000000000103",
          content: "   ",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_MESSAGE",
        message: "Message content must be between 1 and 2,000 characters.",
        retryable: false,
      },
    });
    expect(getConversationApiDependencies).not.toHaveBeenCalled();
    expect(modelClient.createRetrievalPlan).not.toHaveBeenCalled();
  });
});
