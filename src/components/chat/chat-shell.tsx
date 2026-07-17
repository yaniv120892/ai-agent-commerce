"use client";

import { useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";

import { CONVERSATION_TITLE_MAX_LENGTH } from "@/domain/conversations/constants";

import { ChatComposer } from "./chat-composer";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageList } from "./message-list";
import type {
  ChatError,
  ChatErrorCode,
  ChatResponse,
  ChatUiAction,
  ChatUiState,
  PendingRequest,
  PersistedConversation,
  PersistedMessage,
  ProductCardSnapshot,
} from "./types";

type ChatShellProperties = {
  initialConversation: PersistedConversation | null;
};

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
const maximumPollAttempts = 5;
const pollIntervalMs = 500;

function chatReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
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
    id: `${requestId}-pending`,
    lastCategorySlug: null,
    lastSearchTerms: [],
    productCards: [],
    retrievalAnchorMessage: null,
    role: "assistant",
    status: "pending",
  };
}

function createOptimisticConversation(
  existingConversation: PersistedConversation | null,
  content: string,
  requestId: string,
): PersistedConversation {
  const now = new Date().toISOString();
  const existingMessages = existingConversation?.messages ?? [];

  return {
    createdAt: existingConversation?.createdAt ?? now,
    id: existingConversation?.id ?? requestId,
    messages: [
      ...existingMessages,
      createLocalUserMessage(content, requestId),
      createPendingAssistantMessage(requestId),
    ],
    title:
      existingConversation?.title ??
      content.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
    updatedAt: now,
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
  const existingMessages = existingConversation?.messages ?? [];

  return {
    createdAt: existingConversation?.createdAt ?? now,
    id: conversationId,
    messages: [
      ...existingMessages,
      createLocalUserMessage(content, requestId),
      assistantMessage,
    ],
    title:
      existingConversation?.title ??
      content.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
    updatedAt: now,
  };
}

function createPersistenceError(message: string): ChatError {
  return {
    code: "PERSISTENCE_UNAVAILABLE",
    message,
    retryable: true,
  };
}

function createRecoveryConversation(
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

function isPersistedConversation(
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

function isChatError(value: unknown): value is ChatError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code in knownChatErrorCodes &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function isChatResponse(value: unknown): value is ChatResponse {
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

function parseChatError(payload: unknown): ChatError {
  if (isRecord(payload) && isChatError(payload.error)) {
    return payload.error;
  }

  return createPersistenceError(
    "The conversation could not be updated. Please retry.",
  );
}

function parseRecoveryConversationId(
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

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(finish, pollIntervalMs);

    function finish(): void {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", finish);
      resolve();
    }

    signal.addEventListener("abort", finish, { once: true });
  });
}

export function ChatShell({ initialConversation }: ChatShellProperties) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    chatReducer,
    initialConversation,
    createInitialState,
  );
  const activeRequestGeneration = useRef(0);
  const activeRequestController = useRef<AbortController | null>(null);
  const serverConversationId = useRef(initialConversation?.id ?? null);
  const hasPendingMessage = state.conversation?.messages.some(
    (message) => message.status === "pending",
  );
  const composerIsDisabled =
    state.status === "sending" ||
    state.status === "unknownConversation" ||
    hasPendingMessage === true;

  function invalidateActiveRequest(): void {
    activeRequestGeneration.current += 1;
    activeRequestController.current?.abort();
    activeRequestController.current = null;
  }

  function isActiveRequest(generation: number, signal: AbortSignal): boolean {
    return activeRequestGeneration.current === generation && !signal.aborted;
  }

  function finishConversation(
    conversation: PersistedConversation,
    generation: number,
    signal: AbortSignal,
  ): void {
    if (!isActiveRequest(generation, signal)) {
      return;
    }

    activeRequestController.current = null;
    dispatch({ type: "complete", conversation });
    router.push(`/conversations/${conversation.id}`);
  }

  function showRequestError(
    error: ChatError,
    generation: number,
    signal: AbortSignal,
    recoveryConversation?: PersistedConversation,
  ): void {
    if (!isActiveRequest(generation, signal)) {
      return;
    }

    activeRequestController.current = null;
    dispatch({ type: "error", error, recoveryConversation });
  }

  function showUnknownConversation(
    generation: number,
    signal: AbortSignal,
  ): void {
    if (!isActiveRequest(generation, signal)) {
      return;
    }

    activeRequestController.current = null;
    dispatch({ type: "unknownConversation" });
  }

  async function reconcilePendingResponse(
    conversationId: string,
    assistantMessageId: string,
    request: PendingRequest,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; attempt < maximumPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await waitForNextPoll(signal);
      }

      if (!isActiveRequest(generation, signal)) {
        return;
      }

      try {
        const response = await fetch(`/api/conversations/${conversationId}`, {
          signal,
        });
        const payload: unknown = await response.json();

        if (!isActiveRequest(generation, signal)) {
          return;
        }

        if (!response.ok) {
          const error = parseChatError(payload);

          if (error.code === "UNKNOWN_CONVERSATION") {
            showUnknownConversation(generation, signal);
            return;
          }

          showRequestError(error, generation, signal);
          return;
        }

        if (!isPersistedConversation(payload)) {
          if (attempt === maximumPollAttempts - 1) {
            showRequestError(
              createPersistenceError(
                "The conversation response was invalid. Please retry.",
              ),
              generation,
              signal,
            );
          }

          continue;
        }

        const assistantMessage = payload.messages.find(
          (message) => message.id === assistantMessageId,
        );

        if (assistantMessage?.status === "complete") {
          finishConversation(payload, generation, signal);
          return;
        }

        if (assistantMessage?.status === "failed") {
          showRequestError(
            createPersistenceError(
              "The response could not be completed. Please retry.",
            ),
            generation,
            signal,
          );
          return;
        }

        dispatch({ type: "pending", conversation: payload, request });
      } catch {
        if (!isActiveRequest(generation, signal)) {
          return;
        }

        if (attempt === maximumPollAttempts - 1) {
          showRequestError(
            createPersistenceError(
              "The response is taking too long. Please retry.",
            ),
            generation,
            signal,
          );
        }
      }
    }

    showRequestError(
      createPersistenceError("The response is taking too long. Please retry."),
      generation,
      signal,
    );
  }

  async function submitMessage(request: PendingRequest): Promise<void> {
    const baseConversation = state.conversation;
    const conversationId = baseConversation?.id;
    const endpoint = conversationId
      ? `/api/conversations/${conversationId}/messages`
      : "/api/conversations";

    invalidateActiveRequest();
    const generation = activeRequestGeneration.current;
    const controller = new AbortController();
    const { signal } = controller;
    activeRequestController.current = controller;
    dispatch({
      type: "send",
      conversation: createOptimisticConversation(
        baseConversation,
        request.content,
        request.requestId,
      ),
      request,
    });

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          clientRequestId: request.requestId,
          content: request.content,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      });
      const payload: unknown = await response.json();

      if (!isActiveRequest(generation, signal)) {
        return;
      }

      if (!response.ok) {
        const error = parseChatError(payload);
        const recoveryConversationId = parseRecoveryConversationId(
          payload,
          error,
        );

        if (error.code === "UNKNOWN_CONVERSATION") {
          showUnknownConversation(generation, signal);
          return;
        }

        showRequestError(
          error,
          generation,
          signal,
          conversationId === undefined && recoveryConversationId !== null
            ? createRecoveryConversation(
                recoveryConversationId,
                request.content,
              )
            : (baseConversation ?? undefined),
        );
        return;
      }

      if (!isChatResponse(payload)) {
        showRequestError(
          createPersistenceError(
            "The conversation response was invalid. Please retry.",
          ),
          generation,
          signal,
          baseConversation ?? undefined,
        );
        return;
      }

      if (payload.status === "error") {
        if (payload.error.code === "UNKNOWN_CONVERSATION") {
          showUnknownConversation(generation, signal);
          return;
        }

        showRequestError(
          payload.error,
          generation,
          signal,
          baseConversation ?? undefined,
        );
        return;
      }

      const updatedConversation = createConversation(
        baseConversation,
        payload.conversationId,
        request.content,
        request.requestId,
        payload.assistantMessage,
      );

      if (payload.status === "pending") {
        dispatch({
          type: "pending",
          conversation: updatedConversation,
          request,
        });
        await reconcilePendingResponse(
          payload.conversationId,
          payload.assistantMessage.id,
          request,
          generation,
          signal,
        );
        return;
      }

      finishConversation(updatedConversation, generation, signal);
    } catch {
      if (!isActiveRequest(generation, signal)) {
        return;
      }

      showRequestError(
        createPersistenceError(
          "The conversation could not be updated. Please retry.",
        ),
        generation,
        signal,
        baseConversation ?? undefined,
      );
    }
  }

  function handleSubmit(content: string): void {
    void submitMessage({
      content,
      requestId: crypto.randomUUID(),
    });
  }

  function handleNewConversation(): void {
    invalidateActiveRequest();
    dispatch({ type: "newConversation" });
    router.push("/");
  }

  function retryMessage(): void {
    if (state.status === "error") {
      void submitMessage(state.pendingRequest);
    }
  }

  useEffect(() => {
    const nextConversationId = initialConversation?.id ?? null;

    if (serverConversationId.current === nextConversationId) {
      return;
    }

    serverConversationId.current = nextConversationId;
    invalidateActiveRequest();
    dispatch({ type: "synchronize", conversation: initialConversation });
  }, [initialConversation]);

  useEffect(() => {
    return () => {
      activeRequestGeneration.current += 1;
      activeRequestController.current?.abort();
    };
  }, []);

  return (
    <main className="chat-shell">
      <ConversationSidebar
        activeConversationId={state.conversation?.id ?? null}
        onConversationNavigate={invalidateActiveRequest}
        onNewConversation={handleNewConversation}
      />
      <section className="chat-panel">
        <header className="chat-panel__header">
          <p className="chat-panel__eyebrow">AI Commerce Copilot</p>
          <h1>{state.conversation?.title ?? "New conversation"}</h1>
        </header>
        <MessageList messages={state.conversation?.messages ?? []} />
        <div
          aria-live="polite"
          className={`chat-status${state.status === "error" ? " chat-status--error" : ""}`}
          role="status"
        >
          {state.status === "sending" ? (
            <span className="sr-only">Finding a response…</span>
          ) : null}
          {state.status === "error" ? state.error.message : null}
          {state.status === "unknownConversation"
            ? "This conversation is no longer available."
            : null}
        </div>
        {state.status === "error" && state.error.retryable ? (
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
