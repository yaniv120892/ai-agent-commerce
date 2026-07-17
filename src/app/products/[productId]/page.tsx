import { notFound } from "next/navigation";

import { getCatalogClient } from "@/app/api/catalog-dependencies";
import { ProductDetail } from "@/components/product/product-detail";
import { CatalogError } from "@/domain/catalog/types";

type ProductPageProperties = {
  params: Promise<{ productId: string }>;
};

export default async function ProductPage({ params }: ProductPageProperties) {
  const { productId } = await params;
  const parsedProductId = Number(productId);

  if (!Number.isInteger(parsedProductId) || parsedProductId <= 0) {
    notFound();
  }

  const product = await fetchProduct(parsedProductId);

  return <ProductDetail product={product} />;
}

async function fetchProduct(productId: number) {
  try {
    return await getCatalogClient().getProduct(productId);
  } catch (error) {
    if (error instanceof CatalogError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}
