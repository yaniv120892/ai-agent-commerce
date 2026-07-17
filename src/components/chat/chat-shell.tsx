"use client";

import { useReducer } from "react";
import { useRouter } from "next/navigation";

import { ChatComposer } from "./chat-composer";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageList } from "./message-list";
import type {
  ChatError,
  ChatResponse,
  ChatUiAction,
  ChatUiState,
  PendingRequest,
  PersistedConversation,
  PersistedMessage,
} from "./types";

type ChatShellProperties = {
  initialConversation: PersistedConversation | null;
};

type ApiErrorResponse = {
  error?: ChatError;
};

function chatReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
  switch (action.type) {
    case "send": {
      return {
        conversation: state.conversation,
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
        conversation: state.conversation,
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
  }
}

function createInitialState(
  initialConversation: PersistedConversation | null,
): ChatUiState {
  return {
    conversation: initialConversation,
    pendingRequest: null,
    status: "idle",
  };
}

function createLocalUserMessage(
  content: string,
  requestId: string,
): PersistedMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: requestId,
    productCards: [],
    role: "user",
    status: "complete",
  };
}

function createConversation(
  existingConversation: PersistedConversation | null,
  conversationId: string,
  content: string,
  requestId: string,
  assistantMessage: PersistedMessage,
): PersistedConversation {
  const now = new Date().toISOString();
  const messages = existingConversation
    ? existingConversation.messages
    : [createLocalUserMessage(content, requestId)];

  return {
    createdAt: existingConversation?.createdAt ?? now,
    id: conversationId,
    messages: [...messages, assistantMessage],
    title: existingConversation?.title ?? content.slice(0, 60),
    updatedAt: now,
  };
}

function parseChatError(payload: unknown): ChatError {
  const error = (payload as ApiErrorResponse).error;

  return (
    error ?? {
      code: "PERSISTENCE_UNAVAILABLE",
      message: "The conversation could not be updated. Please retry.",
    }
  );
}

export function ChatShell({ initialConversation }: ChatShellProperties) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    chatReducer,
    initialConversation,
    createInitialState,
  );
  const hasPendingMessage = state.conversation?.messages.some(
    (message) => message.status === "pending",
  );
  const composerIsDisabled =
    state.status === "sending" ||
    state.status === "unknownConversation" ||
    hasPendingMessage === true;

  async function submitMessage(request: PendingRequest): Promise<void> {
    const conversationId = state.conversation?.id;
    const endpoint = conversationId
      ? `/api/conversations/${conversationId}/messages`
      : "/api/conversations";

    dispatch({ type: "send", request });

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          clientRequestId: request.requestId,
          content: request.content,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const error = parseChatError(payload);

        if (error.code === "UNKNOWN_CONVERSATION") {
          dispatch({ type: "unknownConversation" });
          return;
        }

        dispatch({ type: "error", error });
        return;
      }

      const chatResponse = payload as ChatResponse;

      if (chatResponse.status === "error") {
        if (chatResponse.error.code === "UNKNOWN_CONVERSATION") {
          dispatch({ type: "unknownConversation" });
          return;
        }

        dispatch({ type: "error", error: chatResponse.error });
        return;
      }

      const updatedConversation = createConversation(
        state.conversation,
        chatResponse.conversationId,
        request.content,
        request.requestId,
        chatResponse.assistantMessage,
      );

      dispatch({ type: "complete", conversation: updatedConversation });
      router.push(`/conversations/${chatResponse.conversationId}`);
    } catch {
      dispatch({
        type: "error",
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "The conversation could not be updated. Please retry.",
        },
      });
    }
  }

  function handleSubmit(content: string): void {
    void submitMessage({
      content,
      requestId: crypto.randomUUID(),
    });
  }

  function handleNewConversation(): void {
    dispatch({ type: "newConversation" });
    router.push("/");
  }

  function retryMessage(): void {
    if (state.status === "error") {
      void submitMessage(state.pendingRequest);
    }
  }

  return (
    <main className="chat-shell">
      <ConversationSidebar
        activeConversationId={state.conversation?.id ?? null}
        onNewConversation={handleNewConversation}
      />
      <section className="chat-panel">
        <header className="chat-panel__header">
          <p>AI Commerce Copilot</p>
          <h1>{state.conversation?.title ?? "New conversation"}</h1>
        </header>
        <MessageList messages={state.conversation?.messages ?? []} />
        <div aria-live="polite" className="chat-status" role="status">
          {state.status === "sending" ? "Finding a response…" : null}
          {state.status === "error" ? state.error.message : null}
          {state.status === "unknownConversation"
            ? "This conversation is no longer available."
            : null}
        </div>
        {state.status === "error" ? (
          <button onClick={retryMessage} type="button">
            Retry
          </button>
        ) : null}
        {state.status === "unknownConversation" ? (
          <button onClick={handleNewConversation} type="button">
            Start a new conversation
          </button>
        ) : null}
        <ChatComposer disabled={composerIsDisabled} onSubmit={handleSubmit} />
      </section>
    </main>
  );
}
