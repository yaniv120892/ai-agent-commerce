export type SpendSnapshot = {
  requestCount: number;
  totalUsd: number;
  unpricedModels: string[];
  usageMissingCount: number;
};

export type MeteredFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
