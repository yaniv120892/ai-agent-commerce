import Image from "next/image";
import Link from "next/link";

import type { ProductCardSnapshot } from "./types";

type ProductCardProperties = {
  product: ProductCardSnapshot;
};

export function ProductCard({ product }: ProductCardProperties) {
  return (
    <Link
      className="product-card"
      href={`/products/${product.productId}`}
      rel="noopener noreferrer"
      target="_blank"
    >
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
        <p className="product-card__description">{product.shortDescription}</p>
        <div className="product-card__footer">
          <p className="product-card__price">${product.price.toFixed(2)}</p>
          {product.rating !== null ? (
            <p className="product-card__rating">
              ★ {product.rating.toFixed(1)}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
