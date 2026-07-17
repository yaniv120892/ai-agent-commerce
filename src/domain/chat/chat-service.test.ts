// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { CatalogError, type RetrievalPlan } from "@/domain/catalog/types";
import { CONVERSATION_TITLE_MAX_LENGTH } from "@/domain/conversations/constants";
import type {
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "@/domain/conversations/types";

import { PlanValidator } from "@/domain/catalog/plan-validator";

import { ChatService } from "./chat-service";
import { PlanRepairService } from "./plan-repair-service";
import { createOpenAIClient, OpenAIModelClient } from "./openai-model-client";
import { ModelError, type ChatErrorCode, type ModelClient } from "./types";

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
    isContinuation: false,
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
    retrievalAnchorMessage: null,
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
    appendMessageWithPendingReply: vi
      .fn()
      .mockImplementation(async (input) => ({
        assistantMessage,
        state: "created",
        userMessageContent: input.content,
      })),
    completeAssistantMessage: vi.fn().mockImplementation(async (input) => ({
      ...assistantMessage,
      content: input.content,
      productCards: input.productCards,
      retrievalAnchorMessage: input.retrievalAnchorMessage,
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
    listAllowedCategorySlugs: vi.fn().mockResolvedValue(["smartphones"]),
    resolve: vi.fn().mockResolvedValue({ productCards }),
  };
  const modelClient: ModelClient = {
    createGroundedReply: vi.fn().mockResolvedValue("Phone Ultra is a match."),
    createRetrievalPlan: vi.fn().mockResolvedValue(createPlan()),
  };

  const planRepairService = new PlanRepairService(
    modelClient,
    (categorySlugs) => new PlanValidator(categorySlugs),
  );

  return {
    assistantMessage,
    catalogResolver,
    conversationRepository,
    modelClient,
    planRepairService,
  };
}

describe("ChatService", () => {
  it("persists the initial user and pending reply before planning, then stores only resolver snapshots", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
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
      activeContext: null,
      allowedCategorySlugs: ["smartphones"],
      history: [createMessage({ content: "Find me a phone" })],
      priorProductIds: [],
      repairContext: null,
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
      retrievalAnchorMessage: "Find me a phone",
    });
    expect(catalogResolver.resolve).toHaveBeenCalledWith(
      {
        ...createPlan(),
        validated: true,
      },
      [],
    );
  });

  it("truncates an overlong first message into the persisted title", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );
    const content = "a".repeat(CONVERSATION_TITLE_MAX_LENGTH + 40);

    await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content,
    });

    expect(
      conversationRepository.createConversationWithPendingReply,
    ).toHaveBeenCalledWith({
      clientRequestId: "request-id",
      content,
      title: "a".repeat(CONVERSATION_TITLE_MAX_LENGTH),
    });
  });

  it("persists the conversation before any model call, even when the model is unavailable", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockRejectedValue(
      new Error("model unavailable"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "  Find me a phone  ",
    });

    expect(
      conversationRepository.createConversationWithPendingReply,
    ).toHaveBeenCalledWith({
      clientRequestId: "request-id",
      content: "Find me a phone",
      title: "Find me a phone",
    });
    expect(response).toMatchObject({
      conversationId: "conversation-id",
      error: { code: "MODEL_UNAVAILABLE" },
      status: "error",
    });
  });

  it("returns safe unsupported text without catalog or grounded-reply access", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
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
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
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
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockRejectedValue(
      new Error("OpenAI unavailable"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
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

  it("marks the persisted assistant reply failed when the category allowlist is unavailable", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    catalogResolver.listAllowedCategorySlugs.mockRejectedValue(
      new Error("catalog unavailable"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
    });

    expect(response).toMatchObject({
      error: { code: "CATALOG_UNAVAILABLE" },
      status: "error",
    });
    expect(conversationRepository.failAssistantMessage).toHaveBeenCalledWith({
      conversationId: "conversation-id",
      messageId: "assistant-message-id",
    });
    expect(modelClient.createRetrievalPlan).not.toHaveBeenCalled();
    expect(catalogResolver.resolve).not.toHaveBeenCalled();
  });

  it("repairs an invalid plan once and completes the reply", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockImplementation(
      async (input) =>
        input.repairContext === null
          ? createPlan({ referencedProductIds: [404], searchTerms: [] })
          : createPlan(),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
    });

    expect(response).toMatchObject({ status: "complete" });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledTimes(2);
    expect(conversationRepository.failAssistantMessage).not.toHaveBeenCalled();
    expect(catalogResolver.resolve).toHaveBeenCalledOnce();
  });

  it("fails with an invalid plan code when the repaired plan is also invalid", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockResolvedValue(
      createPlan({ referencedProductIds: [404], searchTerms: [] }),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
    });

    expect(response).toMatchObject({
      error: { code: "INVALID_RETRIEVAL_PLAN" },
      status: "error",
    });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledTimes(2);
    expect(conversationRepository.failAssistantMessage).toHaveBeenCalledWith({
      conversationId: "conversation-id",
      messageId: "assistant-message-id",
    });
    expect(catalogResolver.resolve).not.toHaveBeenCalled();
  });

  it("reports a catalog outage rather than an invalid plan when retrieval fails", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    catalogResolver.resolve.mockRejectedValue(
      new CatalogError("UPSTREAM_UNAVAILABLE", "dummyjson down"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
    });

    expect(response).toMatchObject({
      error: { code: "CATALOG_UNAVAILABLE" },
      status: "error",
    });
  });

  it("uses only the latest twelve completed messages and their trusted card IDs when appending", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
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
      planRepairService,
    );

    await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
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

  it("carries forward the category established by the most recently resolved reply as activeContext", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const history = [
      createMessage({ content: "Show me phones", id: "message-0" }),
      createMessage({
        content: "Here are phones.",
        id: "message-1",
        productCards: [{ ...productCards[0], productId: 101 }],
        role: "assistant",
      }),
    ];
    conversationRepository.getConversation.mockResolvedValue(
      createConversation(history),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "I want the red one",
      conversationId: "conversation-id",
    });

    expect(modelClient.createRetrievalPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        activeContext: {
          categorySlug: "smartphones",
          lastResolvedUserMessage: null,
        },
      }),
    );
  });

  it("does not carry forward a category when the last resolved reply spans mixed categories", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const history = [
      createMessage({
        content: "Show me electronics",
        id: "message-0",
        productCards: [
          { ...productCards[0], category: "smartphones", productId: 101 },
          { ...productCards[0], category: "laptops", productId: 201 },
        ],
        role: "assistant",
      }),
    ];
    conversationRepository.getConversation.mockResolvedValue(
      createConversation(history),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "I want the cheaper one",
      conversationId: "conversation-id",
    });

    expect(modelClient.createRetrievalPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        activeContext: { categorySlug: null, lastResolvedUserMessage: null },
      }),
    );
  });

  it("returns an existing completed request reply without calling the model again", async () => {
    const {
      assistantMessage,
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const completedAssistantMessage = {
      ...assistantMessage,
      content: "Phone Ultra is a match.",
      productCards,
      status: "complete" as const,
    };
    conversationRepository.appendMessageWithPendingReply.mockResolvedValue({
      assistantMessage: completedAssistantMessage,
      state: "existing",
      userMessageContent: "Find me a phone",
    });
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
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

  it("returns an existing pending request reply without model or catalog work", async () => {
    const {
      assistantMessage,
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    conversationRepository.appendMessageWithPendingReply.mockResolvedValue({
      assistantMessage,
      state: "existing",
      userMessageContent: "Find me a phone",
    });
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
      conversationId: "conversation-id",
    });

    expect(response).toEqual({
      assistantMessage,
      conversationId: "conversation-id",
      status: "pending",
    });
    expect(modelClient.createRetrievalPlan).not.toHaveBeenCalled();
    expect(catalogResolver.resolve).not.toHaveBeenCalled();
  });

  it("processes a failed request after the repository atomically returns it to pending", async () => {
    const {
      assistantMessage,
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    conversationRepository.appendMessageWithPendingReply.mockResolvedValue({
      assistantMessage,
      state: "retried",
      userMessageContent: "Find me a phone",
    });
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
      conversationId: "conversation-id",
    });

    expect(response).toMatchObject({ status: "complete" });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
    expect(catalogResolver.resolve).toHaveBeenCalledOnce();
    expect(
      conversationRepository.completeAssistantMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "assistant-message-id" }),
    );
  });

  it("recovers a post-model persistence failure without a second model pass", async () => {
    const {
      assistantMessage,
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    conversationRepository.completeAssistantMessage.mockRejectedValueOnce(
      new Error("PostgreSQL write failed"),
    );
    conversationRepository.appendMessageWithPendingReply
      .mockResolvedValueOnce({
        assistantMessage,
        state: "created",
        userMessageContent: "Find me a phone",
      })
      .mockResolvedValueOnce({
        assistantMessage,
        state: "retried",
        userMessageContent: "Find me a phone",
      });
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );
    const input = {
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
      conversationId: "conversation-id",
    };

    const failedResponse = await service.appendMessage(input);

    expect(failedResponse).toMatchObject({
      error: { code: "PERSISTENCE_UNAVAILABLE" },
      status: "error",
    });
    expect(conversationRepository.failAssistantMessage).toHaveBeenCalledWith({
      conversationId: "conversation-id",
      messageId: "assistant-message-id",
    });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
    expect(modelClient.createGroundedReply).toHaveBeenCalledOnce();
    expect(catalogResolver.resolve).toHaveBeenCalledOnce();

    const retriedResponse = await service.appendMessage(input);

    expect(retriedResponse).toMatchObject({ status: "complete" });
    expect(modelClient.createRetrievalPlan).toHaveBeenCalledOnce();
    expect(modelClient.createGroundedReply).toHaveBeenCalledOnce();
    expect(catalogResolver.resolve).toHaveBeenCalledOnce();
    expect(
      conversationRepository.appendMessageWithPendingReply,
    ).toHaveBeenCalledTimes(2);
  });

  it("uses persisted request content instead of a changed retry body", async () => {
    const {
      assistantMessage,
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    conversationRepository.appendMessageWithPendingReply.mockResolvedValue({
      assistantMessage,
      state: "retried",
      userMessageContent: "Original saved request",
    });
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Changed retry body",
      conversationId: "conversation-id",
    });

    expect(modelClient.createRetrievalPlan).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: "Original saved request" }),
    );
    expect(modelClient.createGroundedReply).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: "Original saved request" }),
    );
  });

  it("rejects an invalid message before persistence or model access", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
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

  it.each([
    ["AUTH_FAILED", "MODEL_AUTH_FAILED", false],
    ["RATE_LIMITED", "MODEL_RATE_LIMITED", true],
    ["REFUSED", "MODEL_REFUSED", false],
    ["TIMEOUT", "MODEL_TIMEOUT", true],
    ["UNAVAILABLE", "MODEL_UNAVAILABLE", true],
  ] as const)(
    "maps a planner ModelError(%s) to %s with retryable=%s",
    async (modelErrorCode, chatErrorCode, retryable) => {
      const {
        catalogResolver,
        conversationRepository,
        modelClient,
        planRepairService,
      } = createDependencies();
      vi.mocked(modelClient.createRetrievalPlan).mockRejectedValue(
        new ModelError(modelErrorCode, "planner failed"),
      );
      const service = new ChatService(
        conversationRepository,
        catalogResolver,
        modelClient,
        planRepairService,
      );

      const response = await service.startConversation({
        clientRequestId: "request-id",
        content: "Find me a phone",
        requestId: "request-id",
      });

      expect(response).toMatchObject({
        error: { code: chatErrorCode, retryable },
        status: "error",
      });
      expect(catalogResolver.resolve).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["AUTH_FAILED", "MODEL_AUTH_FAILED", false],
    ["RATE_LIMITED", "MODEL_RATE_LIMITED", true],
    ["REFUSED", "MODEL_REFUSED", false],
    ["TIMEOUT", "MODEL_TIMEOUT", true],
    ["UNAVAILABLE", "MODEL_UNAVAILABLE", true],
  ] as const)(
    "maps a grounded-reply ModelError(%s) to %s with retryable=%s",
    async (modelErrorCode, chatErrorCode, retryable) => {
      const {
        catalogResolver,
        conversationRepository,
        modelClient,
        planRepairService,
      } = createDependencies();
      vi.mocked(modelClient.createGroundedReply).mockRejectedValue(
        new ModelError(modelErrorCode, "reply failed"),
      );
      const service = new ChatService(
        conversationRepository,
        catalogResolver,
        modelClient,
        planRepairService,
      );

      const response = await service.startConversation({
        clientRequestId: "request-id",
        content: "Find me a phone",
        requestId: "request-id",
      });

      expect(response).toMatchObject({
        error: { code: chatErrorCode, retryable },
        status: "error",
      });
      expect(conversationRepository.failAssistantMessage).toHaveBeenCalledWith({
        conversationId: "conversation-id",
        messageId: "assistant-message-id",
      });
    },
  );

  it("treats an unrecognized model throw as non-retryable-unavailable", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    vi.mocked(modelClient.createRetrievalPlan).mockRejectedValue(
      new Error("something the client didn't classify"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "Find me a phone",
      requestId: "request-id",
    });

    expect(response).toMatchObject({
      error: { code: "MODEL_UNAVAILABLE", retryable: true },
      status: "error",
    });
  });

  it("marks INVALID_RETRIEVAL_PLAN non-retryable with an honest catalog-lookup message", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    catalogResolver.resolve.mockRejectedValue(
      new CatalogError("INVALID_RETRIEVAL_PLAN", "plan referenced unknown ids"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "Find me a phone",
      requestId: "request-id",
    });

    expect(response).toMatchObject({
      error: {
        code: "INVALID_RETRIEVAL_PLAN",
        message: expect.stringContaining("valid catalog lookup"),
        retryable: false,
      },
      status: "error",
    });
  });

  it("maps a CatalogError(INVALID_RETRIEVAL_PLAN) to the identically named chat code rather than degrading to CATALOG_UNAVAILABLE", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    catalogResolver.resolve.mockRejectedValue(
      new CatalogError("INVALID_RETRIEVAL_PLAN", "plan referenced unknown ids"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "Find me a phone",
      requestId: "request-id",
    });

    const errorCode: ChatErrorCode =
      response.status === "error" ? response.error.code : "MODEL_UNAVAILABLE";

    expect(errorCode).toBe("INVALID_RETRIEVAL_PLAN");
    expect(errorCode).not.toBe("CATALOG_UNAVAILABLE");
  });

  it("still falls back to a CATALOG_UNAVAILABLE code for any other catalog failure", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    catalogResolver.resolve.mockRejectedValue(
      new CatalogError("UPSTREAM_UNAVAILABLE", "DummyJSON is down"),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    const response = await service.startConversation({
      clientRequestId: "request-id",
      content: "Find me a phone",
      requestId: "request-id",
    });

    expect(response).toMatchObject({
      error: { code: "CATALOG_UNAVAILABLE", retryable: true },
      status: "error",
    });
  });

  it("persists the current message as the retrieval anchor for a fresh search turn", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Find me a phone",
    });

    expect(
      conversationRepository.completeAssistantMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalAnchorMessage: "Find me a phone" }),
    );
  });

  it("carries forward the active context's anchor for a continuation turn", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
    const history = [
      createMessage({
        content: "Show me phones",
        id: "message-0",
        retrievalAnchorMessage: null,
      }),
      createMessage({
        content: "Here are phones.",
        id: "message-1",
        productCards: [{ ...productCards[0], productId: 101 }],
        retrievalAnchorMessage: "Show me phones",
        role: "assistant",
      }),
    ];
    conversationRepository.getConversation.mockResolvedValue(
      createConversation(history),
    );
    vi.mocked(modelClient.createRetrievalPlan).mockResolvedValue(
      createPlan({ categorySlug: "smartphones", isContinuation: true }),
    );
    const service = new ChatService(
      conversationRepository,
      catalogResolver,
      modelClient,
      planRepairService,
    );

    await service.appendMessage({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Show me more",
      conversationId: "conversation-id",
    });

    expect(
      conversationRepository.completeAssistantMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalAnchorMessage: "Show me phones" }),
    );
  });

  it("does not persist a retrieval anchor for a non-retrieval turn", async () => {
    const {
      catalogResolver,
      conversationRepository,
      modelClient,
      planRepairService,
    } = createDependencies();
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
      planRepairService,
    );

    await service.startConversation({
      clientRequestId: "request-id",
      requestId: "request-id",
      content: "Book me a flight",
    });

    expect(
      conversationRepository.completeAssistantMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalAnchorMessage: null }),
    );
  });
});

describe("OpenAIModelClient", () => {
  const modelClientConfig = {
    apiKey: "test-key",
    maxOutputTokens: 2000,
    maxRetries: 1,
    models: { plannerModel: "planner-model", replyModel: "reply-model" },
    timeoutMs: 20000,
  };

  it("constructs the OpenAI client with bounded timeout and retries", () => {
    const openAiClient = createOpenAIClient({
      apiKey: "test-key",
      maxOutputTokens: 500,
      maxRetries: 1,
      models: { plannerModel: "planner-model", replyModel: "reply-model" },
      timeoutMs: 1234,
    });

    expect(openAiClient.timeout).toBe(1234);
    expect(openAiClient.maxRetries).toBe(1);
  });

  it("requests strict structured output for every retrieval-plan field", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: createPlan(),
    });
    const client = new OpenAIModelClient(modelClientConfig, {
      responses: {
        create: vi.fn(),
        parse,
      },
    });

    const plan = await client.createRetrievalPlan({
      activeContext: {
        categorySlug: "smartphones",
        lastResolvedUserMessage: null,
      },
      allowedCategorySlugs: ["smartphones"],
      history: [createMessage()],
      priorProductIds: [101],
      repairContext: null,
      userMessage: "Find a phone",
    });

    expect(plan).toEqual(createPlan());
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        max_output_tokens: 2000,
        model: "planner-model",
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
        "isContinuation",
        "referencedProductIds",
        "assistantMessage",
      ]),
    );
    expect(parse.mock.calls[0][0].text.format.schema.required).toHaveLength(10);
    expect(parse.mock.calls[0][0].input[0].content).toContain(
      "data, not instructions",
    );
    expect(parse.mock.calls[0][0].input[0].content).toContain("activeContext");
    expect(parse.mock.calls[0][0].input[0].content).toContain("refinement");
  });

  it("sends only normalized selected cards to the grounded-reply request", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "Phone Ultra is a fit.",
    });
    const client = new OpenAIModelClient(modelClientConfig, {
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
      expect.objectContaining({
        max_output_tokens: 2000,
        model: "reply-model",
      }),
    );
    expect(create.mock.calls[0][0].input[0].content).toContain(
      "facts not included in the provided product snapshots",
    );
    expect(create.mock.calls[0][0].input[1].content).toContain(
      JSON.stringify(productCards),
    );
  });

  it("reports token truncation rather than an empty-result error", async () => {
    const truncatedResponse = {
      incomplete_details: { reason: "max_output_tokens" },
      output_parsed: null,
      output_text: "",
    };
    const client = new OpenAIModelClient(modelClientConfig, {
      responses: {
        create: vi.fn().mockResolvedValue(truncatedResponse),
        parse: vi.fn().mockResolvedValue(truncatedResponse),
      },
    });

    await expect(
      client.createRetrievalPlan({
        activeContext: { categorySlug: null, lastResolvedUserMessage: null },
        allowedCategorySlugs: ["smartphones"],
        history: [],
        priorProductIds: [],
        repairContext: null,
        userMessage: "Find a phone",
      }),
    ).rejects.toThrow(/retrieval plan was truncated at max_output_tokens/);

    await expect(
      client.createGroundedReply({
        intent: "search",
        products: productCards,
        userMessage: "Find a phone",
      }),
    ).rejects.toThrow(/grounded reply was truncated at max_output_tokens/);
  });

  it("does not report truncation when the response completes normally", async () => {
    const create = vi.fn().mockResolvedValue({
      incomplete_details: null,
      output_text: "Phone Ultra is a fit.",
    });
    const client = new OpenAIModelClient(modelClientConfig, {
      responses: { create, parse: vi.fn() },
    });

    await expect(
      client.createGroundedReply({
        intent: "search",
        products: productCards,
        userMessage: "Find a phone",
      }),
    ).resolves.toBe("Phone Ultra is a fit.");
  });
});
