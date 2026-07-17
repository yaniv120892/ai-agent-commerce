import Image from "next/image";

import type { ProductCardSnapshot } from "./types";

type ProductCardProperties = {
  product: ProductCardSnapshot;
};

export function ProductCard({ product }: ProductCardProperties) {
  return (
    <article className="product-card">
      <Image
        alt={product.title}
        height={144}
        src={product.imageUrl}
        unoptimized
        width={224}
      />
      <div className="product-card__content">
        <p className="product-card__category">{product.category}</p>
        <h3>{product.title}</h3>
        <p>{product.shortDescription}</p>
        <p className="product-card__price">${product.price.toFixed(2)}</p>
        {product.rating !== null ? (
          <p>Rating: {product.rating.toFixed(1)}</p>
        ) : null}
      </div>
    </article>
  );
}
