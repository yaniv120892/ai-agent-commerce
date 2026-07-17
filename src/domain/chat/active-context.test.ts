import { describe, expect, it } from "vitest";

import type {
  PersistedMessage,
  ProductCardSnapshot,
} from "../conversations/types";

import { deriveActiveContext } from "./active-context";

const productCard: ProductCardSnapshot = {
  category: "smartphones",
  imageUrl: "https://example.test/phone.png",
  price: 399,
  productId: 101,
  rating: 4.8,
  shortDescription: "A trusted catalog phone",
  title: "Phone Ultra",
};

function createMessage(
  overrides: Partial<PersistedMessage> = {},
): PersistedMessage {
  return {
    content: "Find me a phone",
    createdAt: "2026-07-16T10:00:00.000Z",
    id: "message-id",
    lastCategorySlug: null,
    lastSearchTerms: [],
    productCards: [],
    retrievalAnchorMessage: null,
    role: "user",
    status: "complete",
    ...overrides,
  };
}

describe("deriveActiveContext", () => {
  it("returns null for empty history", () => {
    expect(deriveActiveContext([])).toBeNull();
  });

  it("returns null when no assistant message has product cards", () => {
    const history = [
      createMessage({ content: "Hi", role: "user" }),
      createMessage({ content: "Hello!", role: "assistant" }),
    ];

    expect(deriveActiveContext(history)).toBeNull();
  });

  it("returns the single category when all cards share one category", () => {
    const history = [
      createMessage({
        productCards: [{ ...productCard, productId: 101 }],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: "smartphones",
      lastAttemptedSearch: null,
      lastResolvedUserMessage: null,
    });
  });

  it("returns the dominant category for a non-contiguous majority", () => {
    const history = [
      createMessage({
        productCards: [
          { ...productCard, category: "smartphones", productId: 101 },
          { ...productCard, category: "laptops", productId: 201 },
          { ...productCard, category: "smartphones", productId: 102 },
        ],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: "smartphones",
      lastAttemptedSearch: null,
      lastResolvedUserMessage: null,
    });
  });

  it("breaks an exact category tie by first-encountered category, rather than collapsing to null", () => {
    const history = [
      createMessage({
        productCards: [
          { ...productCard, category: "smartphones", productId: 101 },
          { ...productCard, category: "laptops", productId: 201 },
        ],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: "smartphones",
      lastAttemptedSearch: null,
      lastResolvedUserMessage: null,
    });
  });

  it("only considers the last assistant message that resolved product cards", () => {
    const history = [
      createMessage({
        productCards: [{ ...productCard, category: "laptops", productId: 1 }],
        role: "assistant",
      }),
      createMessage({ content: "I want the red one", role: "user" }),
      createMessage({
        productCards: [
          { ...productCard, category: "smartphones", productId: 101 },
        ],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: "smartphones",
      lastAttemptedSearch: null,
      lastResolvedUserMessage: null,
    });
  });

  it("surfaces a zero-result search's search terms as lastAttemptedSearch", () => {
    const history = [
      createMessage({
        content: "I want a purple phone",
        lastSearchTerms: ["purple", "phone"],
        productCards: [],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: null,
      lastAttemptedSearch: {
        categorySlug: null,
        searchTerms: ["purple", "phone"],
      },
      lastResolvedUserMessage: null,
    });
  });

  it("surfaces a zero-result category browse's categorySlug as lastAttemptedSearch even with no search terms", () => {
    const history = [
      createMessage({
        content: "Show me mens-shoes",
        lastCategorySlug: "mens-shoes",
        productCards: [],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: null,
      lastAttemptedSearch: { categorySlug: "mens-shoes", searchTerms: [] },
      lastResolvedUserMessage: null,
    });
  });

  it("returns null for a plain clarification turn that attempted no search", () => {
    const history = [
      createMessage({
        content: "Which category are you interested in?",
        productCards: [],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toBeNull();
  });

  it("surfaces the most recent retrieval anchor as lastResolvedUserMessage regardless of category derivation", () => {
    const history = [
      createMessage({ content: "Show me phones", role: "user" }),
      createMessage({
        productCards: [{ ...productCard, productId: 101 }],
        retrievalAnchorMessage: "Show me phones",
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toEqual({
      categorySlug: "smartphones",
      lastAttemptedSearch: null,
      lastResolvedUserMessage: "Show me phones",
    });
  });

  it("does not resurface an older resolved category across an intervening zero-result turn", () => {
    const history = [
      createMessage({
        productCards: [
          { ...productCard, category: "smartphones", productId: 101 },
        ],
        role: "assistant",
      }),
      createMessage({ content: "I want the purple one", role: "user" }),
      createMessage({
        content: "Which category are you interested in?",
        productCards: [],
        role: "assistant",
      }),
    ];

    expect(deriveActiveContext(history)).toBeNull();
  });
});
