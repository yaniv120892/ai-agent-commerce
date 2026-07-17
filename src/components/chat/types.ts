import type {
  ChatError,
  ChatErrorCode,
  ChatResponse,
} from "@/domain/chat/types";
import type {
  ConversationSummary,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "@/domain/conversations/types";

export type {
  ChatError,
  ChatErrorCode,
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
  | {
      type: "send";
      conversation: PersistedConversation;
      request: PendingRequest;
    }
  | {
      type: "pending";
      conversation: PersistedConversation;
      request: PendingRequest;
    }
  | {
      type: "complete";
      conversation: PersistedConversation;
    }
  | {
      type: "error";
      error: ChatError;
      recoveryConversation?: PersistedConversation;
    }
  | { type: "unknownConversation" }
  | { type: "newConversation" }
  | {
      type: "synchronize";
      conversation: PersistedConversation | null;
    };
