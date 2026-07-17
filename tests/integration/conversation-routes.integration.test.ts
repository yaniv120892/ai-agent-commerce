import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RetrievalPlan } from "@/domain/catalog/types";
import { ChatService } from "@/domain/chat/chat-service";
import type { ModelClient } from "@/domain/chat/types";
import { ConversationRepository } from "@/domain/conversations/conversation-repository";
import type { ProductCardSnapshot } from "@/domain/conversations/types";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/app/api/conversation-dependencies", () => ({
  getConversationApiDependencies: vi.fn(),
}));

import { getConversationApiDependencies } from "@/app/api/conversation-dependencies";
import { GET as getConversation } from "@/app/api/conversations/[conversationId]/route";
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
  maxPrice: null,
  minRating: null,
  referencedProductIds: [],
  searchTerms: ["phone"],
  sort: "relevance",
};

describe("conversation routes", () => {
  const repository = new ConversationRepository(prisma);
  const catalogResolver = {
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
    ["smartphones"],
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
      },
    });
    expect(modelClient.createRetrievalPlan).not.toHaveBeenCalled();
  });
});
