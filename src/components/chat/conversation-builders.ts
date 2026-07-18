import { CONVERSATION_TITLE_MAX_LENGTH } from "@/domain/conversations/constants";

import type { PersistedConversation, PersistedMessage } from "./types";

export function createOptimisticConversation(
  existingConversation: PersistedConversation | null,
  content: string,
  requestId: string,
): PersistedConversation {
  return appendMessagePair(
    existingConversation,
    content,
    existingConversation?.id ?? requestId,
    createLocalUserMessage(content, requestId),
    createPendingAssistantMessage(requestId),
  );
}

export function createConversationWithServerReply(
  existingConversation: PersistedConversation | null,
  conversationId: string,
  content: string,
  requestId: string,
  assistantMessage: PersistedMessage,
): PersistedConversation {
  return appendMessagePair(
    existingConversation,
    content,
    conversationId,
    createLocalUserMessage(content, requestId),
    assistantMessage,
  );
}

export function createRecoveryConversation(
  conversationId: string,
  content: string,
): PersistedConversation {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: conversationId,
    messages: [],
    title: content.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
    updatedAt: now,
  };
}

function appendMessagePair(
  existingConversation: PersistedConversation | null,
  content: string,
  conversationId: string,
  userMessage: PersistedMessage,
  assistantMessage: PersistedMessage,
): PersistedConversation {
  const now = new Date().toISOString();
  const existingMessages = existingConversation?.messages ?? [];

  return {
    createdAt: existingConversation?.createdAt ?? now,
    id: conversationId,
    messages: [...existingMessages, userMessage, assistantMessage],
    title:
      existingConversation?.title ??
      content.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
    updatedAt: now,
  };
}

function createLocalUserMessage(
  content: string,
  requestId: string,
): PersistedMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    focusedProductId: null,
    id: requestId,
    lastCategorySlug: null,
    lastSearchTerms: [],
    productCards: [],
    retrievalAnchorMessage: null,
    role: "user",
    status: "complete",
  };
}

function createPendingAssistantMessage(requestId: string): PersistedMessage {
  return {
    content: "",
    createdAt: new Date().toISOString(),
    focusedProductId: null,
    id: `${requestId}-pending`,
    lastCategorySlug: null,
    lastSearchTerms: [],
    productCards: [],
    retrievalAnchorMessage: null,
    role: "assistant",
    status: "pending",
  };
}
