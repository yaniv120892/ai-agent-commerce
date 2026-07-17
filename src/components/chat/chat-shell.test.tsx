import { cleanup, render, screen } from "@testing-library/react";
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
});
