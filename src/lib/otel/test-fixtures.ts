import { expect } from "bun:test";
import type { OtelOptions } from "./types.js";

export type FetchCall = {
  url: string;
  init?: RequestInit;
};

export type ExportedSpan = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  kind?: number;
  flags?: number;
  traceState?: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
  events: Array<{ name: string; attributes: unknown[] }>;
  status: { code: number; message?: string };
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
    calls.push({ url: resolveUrl(url), init });
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
      return new Response(null, { status: 503 });
    }

    return new Response(null, { status: 200 });
  };

  return { fetch: mockFetch as typeof fetch, calls };
};

export const createTogglePathFetch = (failPath: string) => {
  const calls: FetchCall[] = [];
  let fail = true;

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const resolved = resolveUrl(url);
    calls.push({ url: resolved, init });

    if (fail) {
      if (resolved.endsWith(failPath)) {
        return new Response(null, { status: 503 });
      }
    }

    return new Response(null, { status: 200 });
  };

  return {
    fetch: mockFetch as typeof fetch,
    calls,
    recover: () => {
      fail = false;
    },
  };
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

export const signalBody = (
  calls: FetchCall[],
  signal: "traces" | "metrics" | "logs",
) => {
  return parseBody(calls.find((call) => call.url.endsWith(`/v1/${signal}`)));
};

export const traceSpans = (calls: FetchCall[]) => {
  const scopes = signalBody(calls, "traces").resourceSpans[0]
    .scopeSpans as Array<{
    spans: ExportedSpan[];
  }>;

  return scopes.flatMap((scope) => scope.spans);
};

export const pathCallCount = (calls: FetchCall[], path: string) => {
  return calls.filter((call) => call.url.endsWith(path)).length;
};
