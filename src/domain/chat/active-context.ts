import type { PersistedMessage } from "../conversations/types";

import type { ActiveRetrievalContext } from "./types";

export function deriveActiveContext(
  history: PersistedMessage[],
): ActiveRetrievalContext | null {
  const lastResolvedMessage = [...history]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" && message.productCards.length > 0,
    );

  if (lastResolvedMessage === undefined) {
    return null;
  }

  const categories = new Set(
    lastResolvedMessage.productCards.map((productCard) => productCard.category),
  );

  return {
    categorySlug: categories.size === 1 ? [...categories][0] : null,
  };
}
