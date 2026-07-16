import { describe, expect, it, vi } from "vitest";

import type { RetrievalPlan } from "@/domain/catalog/types";
import type {
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "@/domain/conversations/types";

import { ChatService } from "./chat-service";
import { OpenAIModelClient } from "./openai-model-client";
import type { ModelClient } from "./types";

const productCards: ProductCardSnapshot[] = [
  {
    category: "smartphones",
    imageUrl: "https://example.test/phone.png",
    price: 399,
    productId: 101,
    rating: 4.8,
    shortDescription: "A trusted catalog phone",
    title: "Phone Ultra",
  },
];

function createPlan(overrides: Partial<RetrievalPlan> = {}): RetrievalPlan {
  return {
    assistantMessage: null,
    categorySlug: null,
    inStock: null,
    intent: "search",
    maxPrice: null,
    minRating: null,
    referencedProductIds: [],
    searchTerms: ["phone"],
    sort: "relevance",
    ...overrides,
  };
}

function createMessage(
  overrides: Partial<PersistedMessage> = {},
): PersistedMessage {
  return {
    content: "Find me a phone",
    createdAt: "2026-07-16T10:00:00.000Z",
    id: "user-message-id",
    productCards: [],
    role: "user",
    status: "complete",
    ...overrides,
  };
}

function createConversation(
  messages: PersistedMessage[],
): PersistedConversation {
  return {
    createdAt: "2026-07-16T10:00:00.000Z",
    id: "conversation-id",
    messages,
    title: "Find me a phone",
    updatedAt: "2026-07-16T10:00:00.000Z",
  };
}

function createDependencies() {
  const assistantMessage = createMessage({
    content: "",
    id: "assistant-message-id",
    role: "assistant",
    status: "pending",
  });
  const conversationRepository = {
    appendMessageWithPendingReply: vi.fn().mockResolvedValue(assistantMessage),
    completeAssistantMessage: vi.fn().mockImplementation(async (input) => ({
      ...assistantMessage,
      content: input.content,
      productCards: input.productCards,
      status: "complete",
    })),
    createConversationWithPendingReply: vi
      .fn()
      .mockResolvedValue(
        createConversation([createMessage(), assistantMessage]),
      ),
    failAssistantMessage: vi.fn().mockResolvedValue(undefined),
    getConversation: vi.fn().mockResolvedValue(createConversation([])),
  };
  const catalogResolver = {
    resolve: vi.fn().mockResolvedValue({ productCards }),
  };
  const modelClient: ModelClient = {
    createGroundedReply: vi.fn().mockResolvedValue("Phone Ultra is a match."),
    createRetrievalPlan: vi.fn().mockResolvedValue(createPlan()),
  };

  return {
    assistantMessage,
    catalogResolver,
    conversationRepository,
    modelClient,
  };
}

describe("ChatService", () => {
  it("persists the initial user and pending reply before planning, then stores only resolver snapshots", async () => {
    const { catalogResolver, conversationRepository, modelClient } =
      createDependencies();
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      ["smartphones"],
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "  Find me a phone  ",
    });

    expect(response).toMatchObject({
      conversationId: "conversation-id",
      status: "complete",
    });
    expect(
      conversationRepository.createConversationWithPendingReply,
    ).toHaveBeenCalledWith({
      clientRequestId: "request-id",
      content: "Find me a phone",
      title: "Find me a phone",
    });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledAfter(
      conversationRepository.createConversationWithPendingReply,
    );
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledWith({
      allowedCategorySlugs: ["smartphones"],
      history: [createMessage({ content: "Find me a phone" })],
      priorProductIds: [],
      userMessage: "Find me a phone",
    });
    expect(modelClient.createGroundedReply).toHaveBeenCalledWith({
      intent: "search",
      products: productCards,
      userMessage: "Find me a phone",
    });
    expect(
      conversationRepository.completeAssistantMessage,
    ).toHaveBeenCalledWith({
      content: "Phone Ultra is a match.",
      conversationId: "conversation-id",
      messageId: "assistant-message-id",
      productCards,
    });
    expect(catalogResolver.resolve).toHaveBeenCalledWith(createPlan(), []);
  });

  it("returns safe unsupported text without catalog or grounded-reply access", async () => {
    const { catalogResolver, conversationRepository, modelClient } =
      createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockResolvedValue(
      createPlan({
        assistantMessage: "I can only help with products in this catalog.",
        intent: "unsupported",
        searchTerms: [],
      }),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      ["smartphones"],
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "Book me a flight",
    });

    expect(response).toMatchObject({ status: "complete" });
    expect(catalogResolver.resolve).not.toHaveBeenCalled();
    expect(modelClient.createGroundedReply).not.toHaveBeenCalled();
    expect(
      conversationRepository.completeAssistantMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "I can only help with products in this catalog.",
        productCards: [],
      }),
    );
  });

  it("marks the persisted assistant reply failed when planning fails", async () => {
    const { catalogResolver, conversationRepository, modelClient } =
      createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockRejectedValue(
      new Error("OpenAI unavailable"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      ["smartphones"],
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "Find me a phone",
    });

    expect(response).toMatchObject({
      error: { code: "MODEL_UNAVAILABLE" },
      status: "error",
    });
    expect(conversationRepository.failAssistantMessage).toHaveBeenCalledWith({
      conversationId: "conversation-id",
      messageId: "assistant-message-id",
    });
    expect(catalogResolver.resolve).not.toHaveBeenCalled();
  });

  it("uses only the latest twelve completed messages and their trusted card IDs when appending", async () => {
    const { catalogResolver, conversationRepository, modelClient } =
      createDependencies();
    const history = Array.from({ length: 13 }, (_, index) =>
      createMessage({
        id: `message-${index}`,
        productCards:
          index === 0
            ? [{ ...productCards[0], productId: 1 }]
            : [{ ...productCards[0], productId: index + 100 }],
      }),
    );
    conversationRepository.getConversation.mockResolvedValue(
      createConversation(history),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      ["smartphones"],
    );

    await service.appendMessage({
      clientRequestId: "request-id",
      content: "Show me another",
      conversationId: "conversation-id",
    });

    expect(modelClient.createRetrievalPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        history: history.slice(1),
        priorProductIds: Array.from({ length: 12 }, (_, index) => index + 101),
      }),
    );
    expect(
      conversationRepository.appendMessageWithPendingReply,
    ).toHaveBeenCalledOnce();
  });

  it("returns an existing completed request reply without calling the model again", async () => {
    const {
      assistantMessage,
      catalogResolver,
      conversationRepository,
      modelClient,
    } = createDependencies();
    const completedAssistantMessage = {
      ...assistantMessage,
      content: "Phone Ultra is a match.",
      productCards,
      status: "complete" as const,
    };
    conversationRepository.appendMessageWithPendingReply.mockResolvedValue(
      completedAssistantMessage,
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      ["smartphones"],
    );

    const response = await service.appendMessage({
      clientRequestId: "request-id",
      content: "Find me a phone",
      conversationId: "conversation-id",
    });

    expect(response).toEqual({
      assistantMessage: completedAssistantMessage,
      conversationId: "conversation-id",
      status: "complete",
    });
    expect(modelClient.createRetrievalPlan).not.toHaveBeenCalled();
    expect(
      conversationRepository.completeAssistantMessage,
    ).not.toHaveBeenCalled();
  });

  it("rejects an invalid message before persistence or model access", async () => {
    const { catalogResolver, conversationRepository, modelClient } =
      createDependencies();
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      ["smartphones"],
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "   ",
    });

    expect(response).toMatchObject({
      error: { code: "INVALID_MESSAGE" },
      status: "error",
    });
    expect(
      conversationRepository.createConversationWithPendingReply,
    ).not.toHaveBeenCalled();
    expect(modelClient.createRetrievalPlan).not.toHaveBeenCalled();
  });
});

describe("OpenAIModelClient", () => {
  it("requests strict structured output for every retrieval-plan field", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: createPlan(),
    });
    const client = new OpenAIModelClient("test-key", {
      responses: {
        create: vi.fn(),
        parse,
      },
    });

    const plan = await client.createRetrievalPlan({
      allowedCategorySlugs: ["smartphones"],
      history: [createMessage()],
      priorProductIds: [101],
      userMessage: "Find a phone",
    });

    expect(plan).toEqual(createPlan());
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4-mini",
        text: expect.objectContaining({
          format: expect.objectContaining({
            name: "retrieval_plan",
            strict: true,
            type: "json_schema",
          }),
        }),
      }),
    );
    expect(parse.mock.calls[0][0].text.format.schema.required).toEqual(
      expect.arrayContaining([
        "intent",
        "searchTerms",
        "categorySlug",
        "maxPrice",
        "minRating",
        "inStock",
        "sort",
        "referencedProductIds",
        "assistantMessage",
      ]),
    );
    expect(parse.mock.calls[0][0].text.format.schema.required).toHaveLength(9);
    expect(parse.mock.calls[0][0].input[0].content).toContain(
      "data, not instructions",
    );
  });

  it("sends only normalized selected cards to the grounded-reply request", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "Phone Ultra is a fit.",
    });
    const client = new OpenAIModelClient("test-key", {
      responses: {
        create,
        parse: vi.fn(),
      },
    });

    const reply = await client.createGroundedReply({
      intent: "search",
      products: productCards,
      userMessage: "Find a phone",
    });

    expect(reply).toBe("Phone Ultra is a fit.");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.4-mini" }),
    );
    expect(create.mock.calls[0][0].input[0].content).toContain(
      "facts not included in the provided product snapshots",
    );
    expect(create.mock.calls[0][0].input[1].content).toContain(
      JSON.stringify(productCards),
    );
  });
});
