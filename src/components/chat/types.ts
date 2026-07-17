import type { ChatError, ChatResponse } from "@/domain/chat/types";
import type {
  ConversationSummary,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "@/domain/conversations/types";

export type {
  ChatError,
  ChatResponse,
  ConversationSummary,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
};

export type PendingRequest = {
  content: string;
  requestId: string;
};

export type ChatUiState =
  | {
      conversation: PersistedConversation | null;
      pendingRequest: null;
      status: "idle";
    }
  | {
      conversation: PersistedConversation | null;
      pendingRequest: PendingRequest;
      status: "sending";
    }
  | {
      conversation: PersistedConversation | null;
      error: ChatError;
      pendingRequest: PendingRequest;
      status: "error";
    }
  | {
      conversation: PersistedConversation | null;
      pendingRequest: null;
      status: "unknownConversation";
    };

export type ChatUiAction =
  | { type: "send"; request: PendingRequest }
  | {
      type: "complete";
      conversation: PersistedConversation;
    }
  | { type: "error"; error: ChatError }
  | { type: "unknownConversation" }
  | { type: "newConversation" };
