import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MessageList } from "./message-list";
import type { PersistedMessage } from "./types";

afterEach(() => {
  cleanup();
});

it("renders markdown emphasis in assistant replies instead of literal asterisks", () => {
  const messages: PersistedMessage[] = [
    {
      content: "The best pick is **Huawei Matebook X Pro** at **$1,399.99**.",
      createdAt: "2026-07-17T10:00:00.000Z",
      focusedProductId: null,
      id: "00000000-0000-4000-8000-000000000001",
      lastCategorySlug: null,
      lastSearchTerms: [],
      productCards: [],
      retrievalAnchorMessage: null,
      retrievalExhausted: false,
      role: "assistant",
      status: "complete",
    },
  ];

  render(<MessageList messages={messages} />);

  expect(
    screen.getByText("Huawei Matebook X Pro", { selector: "strong" }),
  ).toBeVisible();
  expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
});
