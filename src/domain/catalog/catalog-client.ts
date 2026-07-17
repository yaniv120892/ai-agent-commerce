import { z } from "zod";

import {
  CatalogError,
  type CatalogClientContract,
  type CatalogProduct,
} from "./types";

const productSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  price: z.number().nonnegative(),
  rating: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  availabilityStatus: z.string(),
  thumbnail: z.string().url(),
  images: z.array(z.string().url()),
});

const productListSchema = z.object({
  products: z.array(productSchema),
});

const categoryListSchema = z.array(z.string().min(1));

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class CatalogClient implements CatalogClientContract {
  public constructor(
    private readonly fetchFunction: FetchFunction,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async searchProducts(searchTerm: string): Promise<CatalogProduct[]> {
    const response = await this.request(
      ["products", "search"],
      { limit: "100", q: searchTerm },
      productListSchema,
    );

    return response.products;
  }

  public async listCategoryProducts(
    categorySlug: string,
  ): Promise<CatalogProduct[]> {
    const response = await this.request(
      ["products", "category", categorySlug],
      { limit: "100" },
      productListSchema,
    );

    return response.products;
  }

  public async listProducts(): Promise<CatalogProduct[]> {
    const response = await this.request(
      ["products"],
      { limit: "100" },
      productListSchema,
    );

    return response.products;
  }

  public async getProduct(productId: number): Promise<CatalogProduct> {
    return this.request(["products", String(productId)], {}, productSchema);
  }

  public async listCategorySlugs(): Promise<string[]> {
    return this.request(["products", "category-list"], {}, categoryListSchema);
  }

  private async request<T>(
    pathSegments: string[],
    query: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          this.createUrl(pathSegments, query),
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new CatalogError(
              "NOT_FOUND",
              "Catalog product was not found",
            );
          }

          if (response.status >= 500 && attempt === 0) {
            continue;
          }

          throw new CatalogError(
            "UPSTREAM_UNAVAILABLE",
            "Catalog service is unavailable",
          );
        }

        return await this.parseResponse(response, schema);
      } catch (error) {
        if (error instanceof CatalogError) {
          throw error;
        }

        if (attempt === 0) {
          continue;
        }

        throw new CatalogError(
          "UPSTREAM_UNAVAILABLE",
          "Catalog service is unavailable",
        );
      }
    }

    throw new CatalogError(
      "UPSTREAM_UNAVAILABLE",
      "Catalog service is unavailable",
    );
  }

  private createUrl(
    pathSegments: string[],
    query: Record<string, string>,
  ): URL {
    const url = new URL(this.baseUrl);
    const encodedPath = pathSegments.map((segment) =>
      encodeURIComponent(segment),
    );
    const queryParameters = new URLSearchParams(query);

    url.pathname = `/${encodedPath.join("/")}`;
    url.search = queryParameters.toString();

    return url;
  }

  private async fetchWithTimeout(url: URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchFunction(url, {
        headers: {
          Accept: "application/json",
        },
        method: "GET",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse<T>(
    response: Response,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw new CatalogError(
        "INVALID_UPSTREAM_PAYLOAD",
        "Catalog service returned invalid JSON",
      );
    }

    const parsedPayload = schema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new CatalogError(
        "INVALID_UPSTREAM_PAYLOAD",
        "Catalog service returned an invalid payload",
      );
    }

    return parsedPayload.data;
  }
}
