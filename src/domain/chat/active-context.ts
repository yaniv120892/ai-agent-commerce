import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "../conversations/types";

import type { ActiveRetrievalContext } from "./types";

export function deriveActiveContext(
  history: PersistedMessage[],
): ActiveRetrievalContext | null {
  const lastAssistantMessage = [...history]
    .reverse()
    .find((message) => message.role === "assistant");

  if (lastAssistantMessage === undefined) {
    return null;
  }

  const lastAnchorMessage = [...history]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" && message.retrievalAnchorMessage !== null,
    );
  const lastResolvedUserMessage =
    lastAnchorMessage?.retrievalAnchorMessage ?? null;

  if (lastAssistantMessage.productCards.length > 0) {
    return {
      categorySlug: deriveDominantCategory(lastAssistantMessage.productCards),
      lastAttemptedSearch: null,
      lastResolvedUserMessage,
    };
  }

  const attemptedSearch =
    lastAssistantMessage.lastSearchTerms.length > 0 ||
    lastAssistantMessage.lastCategorySlug !== null;

  if (!attemptedSearch && lastResolvedUserMessage === null) {
    return null;
  }

  return {
    categorySlug: null,
    lastAttemptedSearch: attemptedSearch
      ? {
          categorySlug: lastAssistantMessage.lastCategorySlug,
          searchTerms: lastAssistantMessage.lastSearchTerms,
        }
      : null,
    lastResolvedUserMessage,
  };
}

function deriveDominantCategory(productCards: ProductCardSnapshot[]): string {
  const countByCategory = new Map<string, number>();
  let dominantCategory = productCards[0].category;
  let dominantCount = 0;

  for (const productCard of productCards) {
    const count = (countByCategory.get(productCard.category) ?? 0) + 1;
    countByCategory.set(productCard.category, count);

    if (count > dominantCount) {
      dominantCount = count;
      dominantCategory = productCard.category;
    }
  }

  return dominantCategory;
}
