import type {
  ChatError,
  ChatErrorCode,
  ChatResponse,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "./types";

const knownChatErrorCodes = {
  CATALOG_UNAVAILABLE: true,
  INVALID_MESSAGE: true,
  INVALID_RETRIEVAL_PLAN: true,
  MODEL_AUTH_FAILED: true,
  MODEL_RATE_LIMITED: true,
  MODEL_REFUSED: true,
  MODEL_TIMEOUT: true,
  MODEL_UNAVAILABLE: true,
  PERSISTENCE_UNAVAILABLE: true,
  UNKNOWN_CONVERSATION: true,
} satisfies Record<ChatErrorCode, true>;

const messageRoles = ["user", "assistant"] as const;
const messageStatuses = ["pending", "complete", "failed"] as const;

export function isPersistedConversation(
  value: unknown,
): value is PersistedConversation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isPersistedMessage)
  );
}

export function isChatResponse(value: unknown): value is ChatResponse {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }

  if (value.status === "complete" || value.status === "pending") {
    return (
      typeof value.conversationId === "string" &&
      isPersistedMessage(value.assistantMessage)
    );
  }

  return (
    value.status === "error" &&
    (typeof value.conversationId === "string" ||
      value.conversationId === null) &&
    (isPersistedMessage(value.assistantMessage) ||
      value.assistantMessage === null) &&
    isChatError(value.error)
  );
}

export function parseChatError(payload: unknown): ChatError {
  if (isRecord(payload) && isChatError(payload.error)) {
    return payload.error;
  }

  return createPersistenceError(
    "The conversation could not be updated. Please retry.",
  );
}

export function parseRecoveryConversationId(
  payload: unknown,
  error: ChatError,
): string | null {
  if (
    error.code !== "PERSISTENCE_UNAVAILABLE" ||
    !isRecord(payload) ||
    typeof payload.conversationId !== "string"
  ) {
    return null;
  }

  return payload.conversationId;
}

export function createPersistenceError(message: string): ChatError {
  return {
    code: "PERSISTENCE_UNAVAILABLE",
    message,
    retryable: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProductCardSnapshot(value: unknown): value is ProductCardSnapshot {
  return (
    isRecord(value) &&
    typeof value.productId === "number" &&
    typeof value.title === "string" &&
    typeof value.shortDescription === "string" &&
    typeof value.price === "number" &&
    typeof value.imageUrl === "string" &&
    typeof value.category === "string" &&
    (typeof value.rating === "number" || value.rating === null)
  );
}

function isPersistedMessage(value: unknown): value is PersistedMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.role === "string" &&
    messageRoles.includes(value.role as (typeof messageRoles)[number]) &&
    typeof value.status === "string" &&
    messageStatuses.includes(
      value.status as (typeof messageStatuses)[number],
    ) &&
    Array.isArray(value.productCards) &&
    value.productCards.every(isProductCardSnapshot)
  );
}

function isChatError(value: unknown): value is ChatError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code in knownChatErrorCodes &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}
