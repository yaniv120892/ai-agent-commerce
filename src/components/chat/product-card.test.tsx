import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ProductCard } from "./product-card";
import type { ProductCardSnapshot } from "./types";

afterEach(() => {
  cleanup();
});

const product: ProductCardSnapshot = {
  category: "smartphones",
  imageUrl: "https://example.com/phone.jpg",
  price: 399.99,
  productId: 42,
  rating: 4.5,
  shortDescription: "A great phone.",
  title: "Test Phone",
};

it("links the product card to its detail page in a new tab", () => {
  render(<ProductCard product={product} />);

  const link = screen.getByRole("link", { name: /Test Phone/u });

  expect(link).toHaveAttribute("href", "/products/42");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
