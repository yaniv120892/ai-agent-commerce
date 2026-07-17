import type { ChatUiAction, ChatUiState, PersistedConversation } from "./types";

export function chatReducer(
  state: ChatUiState,
  action: ChatUiAction,
): ChatUiState {
  switch (action.type) {
    case "send": {
      return {
        conversation: action.conversation,
        pendingRequest: action.request,
        status: "sending",
      };
    }
    case "pending": {
      return {
        conversation: action.conversation,
        pendingRequest: action.request,
        status: "sending",
      };
    }
    case "complete": {
      return {
        conversation: action.conversation,
        pendingRequest: null,
        status: "idle",
      };
    }
    case "error": {
      if (state.status !== "sending") {
        return state;
      }

      return {
        conversation: action.recoveryConversation ?? state.conversation,
        error: action.error,
        pendingRequest: state.pendingRequest,
        status: "error",
      };
    }
    case "unknownConversation": {
      return {
        conversation: state.conversation,
        pendingRequest: null,
        status: "unknownConversation",
      };
    }
    case "newConversation": {
      return {
        conversation: null,
        pendingRequest: null,
        status: "idle",
      };
    }
    case "synchronize": {
      return {
        conversation: action.conversation,
        pendingRequest: null,
        status: "idle",
      };
    }
  }
}

export function createInitialChatUiState(
  initialConversation: PersistedConversation | null,
): ChatUiState {
  return {
    conversation: initialConversation,
    pendingRequest: null,
    status: "idle",
  };
}
