import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedConversation } from "@/domain/conversations/types";

import { ChatShell } from "./chat-shell";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const conversation: PersistedConversation = {
  createdAt: "2026-07-17T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  messages: [
    {
      content: "I found a phone that matches your budget.",
      createdAt: "2026-07-17T10:00:01.000Z",
      id: "00000000-0000-4000-8000-000000000002",
      lastCategorySlug: null,
      lastSearchTerms: [],
      productCards: [
        {
          category: "smartphones",
          imageUrl: "https://example.test/phone-ultra.png",
          price: 399,
          productId: 101,
          rating: 4.8,
          shortDescription: "A dependable phone for everyday work.",
          title: "Phone Ultra",
        },
      ],
      role: "assistant",
      status: "complete",
    },
  ],
  title: "Phone shopping",
  updatedAt: "2026-07-17T10:00:01.000Z",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function createAssistantMessage(content: string) {
  return {
    content,
    createdAt: "2026-07-17T10:01:00.000Z",
    id: "00000000-0000-4000-8000-000000000003",
    productCards: [],
    role: "assistant" as const,
    status: "complete" as const,
  };
}

describe("ChatShell", () => {
  beforeEach(() => {
    push.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders product cards from snapshots rather than assistant message text", () => {
    render(<ChatShell initialConversation={conversation} />);

    expect(screen.getByRole("img", { name: "Phone Ultra" })).toBeVisible();
    expect(screen.getByText("Phone Ultra")).toBeVisible();
    expect(screen.getByText("$399.00")).toBeVisible();
  });

  it("disables the composer while a message is pending", () => {
    render(
      <ChatShell
        initialConversation={{
          ...conversation,
          messages: [
            {
              ...conversation.messages[0],
              productCards: [],
              status: "pending",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("offers a new conversation when the current conversation is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "UNKNOWN_CONVERSATION",
              message: "This conversation is no longer available.",
              retryable: false,
            },
          }),
          { status: 404 },
        ),
      ),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Show me another phone");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByRole("button", { name: "Start a new conversation" }),
    ).toBeVisible();
  });

  it("retries an initial persistence failure through the created conversation", async () => {
    const createdConversationId = "00000000-0000-4000-8000-000000000009";
    const postUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          postUrls.push(url);

          if (postUrls.length === 1) {
            return Promise.resolve(
              jsonResponse(
                {
                  conversationId: createdConversationId,
                  error: {
                    code: "PERSISTENCE_UNAVAILABLE",
                    message:
                      "Conversation storage is unavailable. Please retry.",
                    retryable: true,
                  },
                },
                503,
              ),
            );
          }

          return Promise.resolve(
            jsonResponse({
              assistantMessage: createAssistantMessage("Recovered response."),
              conversationId: createdConversationId,
              status: "complete",
            }),
          );
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={null} />);
    await user.type(screen.getByLabelText("Message"), "Find me a phone");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Recovered response.")).toBeVisible();
    expect(postUrls).toEqual([
      "/api/conversations",
      `/api/conversations/${createdConversationId}/messages`,
    ]);
  });

  it("does not offer Retry for a non-retryable model error, and preserves its own code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          return Promise.resolve(
            jsonResponse(
              {
                conversationId: conversation.id,
                error: {
                  code: "MODEL_AUTH_FAILED",
                  message:
                    "The assistant is not configured correctly. Please contact support.",
                  retryable: false,
                },
              },
              503,
            ),
          );
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Find me a phone");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText(
        "The assistant is not configured correctly. Please contact support.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("displays a submitted user message in an existing conversation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          return Promise.resolve(
            jsonResponse({
              assistantMessage: createAssistantMessage(
                "Here is another phone.",
              ),
              conversationId: conversation.id,
              status: "complete",
            }),
          );
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Show another phone");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Show another phone")).toBeVisible();
    expect(await screen.findByText("Here is another phone.")).toBeVisible();
  });

  it("shows the submitted message and a loading indicator before the response arrives", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          return pendingResponse;
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Show another phone");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Show another phone")).toBeVisible();
    expect(screen.getByText("Finding products for you")).toBeVisible();

    resolveResponse?.(
      jsonResponse({
        assistantMessage: createAssistantMessage("Here is another phone."),
        conversationId: conversation.id,
        status: "complete",
      }),
    );

    expect(await screen.findByText("Here is another phone.")).toBeVisible();
    expect(
      screen.queryByText("Finding products for you"),
    ).not.toBeInTheDocument();
  });

  it("synchronizes the shell when the server-provided conversation changes", () => {
    const { rerender } = render(
      <ChatShell initialConversation={conversation} />,
    );
    const nextConversation: PersistedConversation = {
      ...conversation,
      id: "00000000-0000-4000-8000-000000000004",
      messages: [
        {
          ...conversation.messages[0],
          content: "A different conversation.",
          id: "00000000-0000-4000-8000-000000000005",
          productCards: [],
        },
      ],
      title: "Different shopping",
    };

    rerender(<ChatShell initialConversation={nextConversation} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Different shopping" }),
    ).toBeVisible();
    expect(screen.getByText("A different conversation.")).toBeVisible();
    expect(
      screen.queryByText("I found a phone that matches your budget."),
    ).not.toBeInTheDocument();
  });

  it("keeps the composer disabled while a pending response is reconciled", async () => {
    let resolveConversation: ((response: Response) => void) | undefined;
    const conversationResponse = new Promise<Response>((resolve) => {
      resolveConversation = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          return Promise.resolve(
            jsonResponse({
              assistantMessage: {
                ...createAssistantMessage(""),
                status: "pending",
              },
              conversationId: conversation.id,
              status: "pending",
            }),
          );
        }

        if (url.includes(`/${conversation.id}`)) {
          return conversationResponse;
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Show another phone");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Finding a response…",
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    resolveConversation?.(
      jsonResponse({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            ...createAssistantMessage("The completed recommendation."),
          },
        ],
      }),
    );

    expect(
      await screen.findByText("The completed recommendation."),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByLabelText("Message")).toBeEnabled();
    });
  });

  it("ignores a stale response after starting a new conversation", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          requestSignal = options.signal ?? undefined;
          return pendingResponse;
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Show another phone");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "New conversation" }));

    expect(requestSignal?.aborted).toBe(true);

    resolveResponse?.(
      jsonResponse({
        assistantMessage: createAssistantMessage("Stale recommendation."),
        conversationId: conversation.id,
        status: "complete",
      }),
    );

    await Promise.resolve();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/");
    expect(screen.queryByText("Stale recommendation.")).not.toBeInTheDocument();
  });

  it("aborts an in-flight request when navigating to a recent conversation", async () => {
    let requestSignal: AbortSignal | undefined;
    const pendingResponse = new Promise<Response>(() => undefined);
    const nextConversationId = "00000000-0000-4000-8000-000000000007";

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          requestSignal = options.signal ?? undefined;
          return pendingResponse;
        }

        if (url.includes("?limit=")) {
          return Promise.resolve(
            jsonResponse([
              {
                createdAt: "2026-07-17T10:02:00.000Z",
                id: nextConversationId,
                title: "Recent shopping",
                updatedAt: "2026-07-17T10:02:00.000Z",
              },
            ]),
          );
        }

        return Promise.resolve(jsonResponse([]));
      }),
    );
    const user = userEvent.setup();

    render(<ChatShell initialConversation={conversation} />);
    await user.type(screen.getByLabelText("Message"), "Show another phone");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const conversationLink = await screen.findByRole("link", {
      name: "Recent shopping",
    });
    conversationLink.addEventListener(
      "click",
      (event) => event.preventDefault(),
      {
        once: true,
      },
    );
    await user.click(conversationLink);

    expect(requestSignal?.aborted).toBe(true);
  });

  it("renders one page heading for a new conversation", () => {
    render(<ChatShell initialConversation={null} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
