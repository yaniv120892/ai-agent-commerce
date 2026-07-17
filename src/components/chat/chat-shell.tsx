"use client";

import { useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";

import { ChatComposer } from "./chat-composer";
import { chatReducer, createInitialChatUiState } from "./chat-reducer";
import {
  createPersistenceError,
  isChatResponse,
  isPersistedConversation,
  parseChatError,
  parseRecoveryConversationId,
} from "./chat-response-parsing";
import {
  createConversationWithServerReply,
  createOptimisticConversation,
  createRecoveryConversation,
} from "./conversation-builders";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageList } from "./message-list";
import type { ChatError, PendingRequest, PersistedConversation } from "./types";

type ChatShellProperties = {
  initialConversation: PersistedConversation | null;
};

const maximumPollAttempts = 5;
const pollIntervalMs = 500;

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
    createInitialChatUiState,
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
    showConversationUrl(conversation.id);
  }

  // A router.push here would remount the shell ("/" and "/conversations/
  // [conversationId]" are different route segments), and the unmount abort
  // would cancel a follow-up message sent before the navigation settles. The
  // completed conversation is already fully client-side, so update only the
  // URL; Next patches history.pushState to keep the router in sync.
  function showConversationUrl(conversationId: string): void {
    const conversationPath = `/conversations/${conversationId}`;

    if (window.location.pathname === conversationPath) {
      return;
    }

    window.history.pushState(null, "", conversationPath);
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

      const updatedConversation = createConversationWithServerReply(
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
