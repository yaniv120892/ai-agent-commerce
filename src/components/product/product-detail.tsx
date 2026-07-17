import Image from "next/image";
import Link from "next/link";

import type { CatalogProduct } from "@/domain/catalog/types";

type ProductDetailProperties = {
  product: CatalogProduct;
};

export function ProductDetail({ product }: ProductDetailProperties) {
  const galleryImages =
    product.images.length > 0 ? product.images : [product.thumbnail];

  return (
    <main className="product-detail">
      <Link className="product-detail__back" href="/">
        ← Back to chat
      </Link>
      <article className="product-detail__layout">
        <div className="product-detail__gallery">
          <Image
            alt={product.title}
            className="product-detail__hero-image"
            height={480}
            src={galleryImages[0]}
            unoptimized
            width={480}
          />
          {galleryImages.length > 1 ? (
            <div className="product-detail__thumbnails">
              {galleryImages.map((imageUrl) => (
                <Image
                  alt={product.title}
                  height={96}
                  key={imageUrl}
                  src={imageUrl}
                  unoptimized
                  width={96}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="product-detail__content">
          <p className="product-detail__category">{product.category}</p>
          <h1>{product.title}</h1>
          <div className="product-detail__meta">
            <p className="product-detail__price">${product.price.toFixed(2)}</p>
            <p className="product-detail__rating">
              ★ {product.rating.toFixed(1)}
            </p>
            <p
              className={`product-detail__availability product-detail__availability--${
                product.stock > 0 ? "in-stock" : "out-of-stock"
              }`}
            >
              {product.availabilityStatus} · {product.stock} in stock
            </p>
          </div>
          <p className="product-detail__description">{product.description}</p>
        </div>
      </article>
    </main>
  );
}
