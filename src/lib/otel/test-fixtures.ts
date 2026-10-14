import { expect } from "bun:test";
import type { OtelOptions } from "./types.js";

export type FetchCall = {
  url: string;
  init?: RequestInit;
};

export const resolveUrl = (url: string | URL | Request) => {
  if (typeof url === "string") {
    return url;
  }

  if (url instanceof URL) {
    return url.toString();
  }

  return url.url;
};

export const createMockFetch = (status = 200) => {
  const calls: FetchCall[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const resolved = resolveUrl(url);
    calls.push({ url: resolved, init });

    return new Response(null, { status });
  };

  return { fetch: mockFetch as typeof fetch, calls };
};

export const createFailingPathFetch = (failPath: string) => {
  const calls: FetchCall[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const resolved = resolveUrl(url);
    calls.push({ url: resolved, init });

    if (resolved.endsWith(failPath)) {
      return new Response(null, { status: 500 });
    }

    return new Response(null, { status: 200 });
  };

  return { fetch: mockFetch as typeof fetch, calls };
};

export const baseOptions = (
  fetchImpl: typeof fetch,
  overrides?: Partial<OtelOptions>,
) => ({
  serviceName: "test-svc",
  export: { type: "otlp-http" as const, url: "http://collector:4318" },
  sampleRatio: 1,
  enabled: true,
  flushIntervalMs: 60_000,
  shutdownTimeoutMs: 0,
  fetch: fetchImpl,
  ...overrides,
});

export const parseBody = (call: FetchCall | undefined) => {
  expect(call).toBeDefined();
  return JSON.parse(String(call?.init?.body));
};
