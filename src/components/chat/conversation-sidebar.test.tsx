import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ConversationSidebar } from "./conversation-sidebar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("filters malformed conversation summaries before rendering recent links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          null,
          {
            createdAt: "2026-07-17T10:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000001",
            title: "Phone shopping",
            updatedAt: "2026-07-17T10:00:01.000Z",
          },
        ]),
      ),
    ),
  );

  render(
    <ConversationSidebar
      activeConversationId={null}
      onConversationNavigate={vi.fn()}
      onNewConversation={vi.fn()}
    />,
  );

  const link = await screen.findByRole("link", { name: "Phone shopping" });

  expect(link).toBeVisible();
  expect(link).toHaveAttribute("title", "Phone shopping");
  expect(screen.getAllByRole("link")).toHaveLength(1);
});
