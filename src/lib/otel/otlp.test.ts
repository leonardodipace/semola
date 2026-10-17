import { describe, expect, test } from "bun:test";
import { ExportError } from "./errors.js";
import {
  encodeAttributes,
  encodeAttributeValue,
  encodeMetric,
  encodeSpan,
  otlpPost,
} from "./otlp.js";
import type { FinishedSpan } from "./types.js";
import { HISTOGRAM_EXPLICIT_BOUNDS } from "./types.js";

const sampleSpan = (overrides: Partial<FinishedSpan> = {}): FinishedSpan => ({
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  parentSpanId: "c".repeat(16),
  name: "op",
  kind: 1,
  flags: 0x100,
  startTimeUnixNano: "1",
  endTimeUnixNano: "2",
  attributes: { "http.method": "GET", retry: false, count: 3 },
  events: [
    {
      name: "checkpoint",
      timeUnixNano: "1",
      attributes: { step: "one" },
    },
  ],
  status: { code: "ERROR", message: "failed" },
  scopeName: "scope",
  scopeVersion: "1",
  ...overrides,
});

const postWith = async (
  fetchImpl: typeof fetch,
  extras?: {
    signal?: AbortSignal;
    path?: "/v1/traces" | "/v1/metrics" | "/v1/logs";
  },
) => {
  return otlpPost({
    baseUrl: "http://collector:4318",
    path: extras?.path ?? "/v1/traces",
    body: {},
    fetch: fetchImpl,
    signal: extras?.signal,
  });
};

const countingFetch = (status: number, okAfter?: number) => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;

    if (okAfter !== undefined) {
      if (attempts >= okAfter) {
        return new Response(null, { status: 200 });
      }
    }

    return new Response(null, { status });
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, attempts: () => attempts };
};

describe("otlp encode", () => {
  test("encodes attributes spans and metric shapes", () => {
    expect(encodeAttributeValue("x")).toEqual({ stringValue: "x" });
    expect(encodeAttributeValue(4)).toEqual({ intValue: "4" });
    expect(encodeAttributeValue(1.5)).toEqual({ doubleValue: 1.5 });
    expect(encodeAttributeValue([true, false])).toEqual({
      arrayValue: {
        values: [{ boolValue: true }, { boolValue: false }],
      },
    });
    expect(
      encodeAttributes({ b: "2", a: "1" }).map((pair) => pair.key),
    ).toEqual(["a", "b"]);

    const full = encodeSpan(sampleSpan());
    expect(full.status).toEqual({ code: 2, message: "failed" });
    expect(
      encodeSpan(sampleSpan({ status: { code: "UNSET" } })).status,
    ).toEqual({ code: 0 });
    expect(
      encodeSpan(
        sampleSpan({ parentSpanId: undefined, status: { code: "OK" } }),
      ).parentSpanId,
    ).toBeUndefined();

    expect(
      encodeMetric({
        name: "hits",
        kind: "counter",
        scopeName: "m",
        dataPoints: [{ attributes: {}, timeUnixNano: "1", value: 4 }],
      }).sum?.isMonotonic,
    ).toBe(true);
    expect(
      encodeMetric({
        name: "depth",
        kind: "updowncounter",
        scopeName: "m",
        dataPoints: [{ attributes: {}, timeUnixNano: "1", value: -1 }],
      }).sum?.isMonotonic,
    ).toBe(false);
    expect(
      encodeMetric({
        name: "latency",
        kind: "histogram",
        scopeName: "m",
        dataPoints: [
          {
            attributes: {},
            timeUnixNano: "1",
            count: 2,
            sum: 10,
            min: 1,
            max: 9,
            bucketCounts: [1, 0, 1],
            explicitBounds: [...HISTOGRAM_EXPLICIT_BOUNDS].slice(0, 2),
          },
        ],
      }).histogram?.dataPoints[0]?.bucketCounts,
    ).toEqual(["1", "0", "1"]);
  });
});

describe("otlpPost", () => {
  test("posts json retries and guards response bodies", async () => {
    let seen: RequestInit | undefined;
    await otlpPost({
      baseUrl: "http://collector:4318/",
      path: "/v1/traces",
      body: { ok: true },
      fetch: (async (_url, init) => {
        seen = init;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      headers: { "x-test": "1" },
    });
    expect(seen?.method).toBe("POST");
    expect((seen?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const retryable = countingFetch(503);
    await expect(
      postWith(retryable.fetch, { path: "/v1/logs" }),
    ).rejects.toThrow("OTLP export failed with status 503");
    expect(retryable.attempts()).toBe(3);

    const client = countingFetch(400);
    await expect(postWith(client.fetch)).rejects.toThrow(
      "OTLP export failed with status 400",
    );
    expect(client.attempts()).toBe(1);

    const recovered = countingFetch(503, 2);
    await postWith(recovered.fetch);
    expect(recovered.attempts()).toBe(2);

    await postWith(
      (async () =>
        new Response(null, { status: 204 })) as unknown as typeof fetch,
      { path: "/v1/metrics" },
    );

    await expect(
      postWith(
        (async () =>
          new Response(
            JSON.stringify({ partialSuccess: { rejectedSpans: 2 } }),
            {
              status: 200,
            },
          )) as unknown as typeof fetch,
      ),
    ).rejects.toThrow("OTLP partial success rejected 2 records");

    try {
      await postWith(
        (async () =>
          new Response("x".repeat(65_537), {
            status: 200,
          })) as unknown as typeof fetch,
      );
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ExportError);
      expect((error as ExportError).retryable).toBe(false);
    }

    let attempts = 0;
    const controller = new AbortController();
    await expect(
      postWith(
        (async () => {
          attempts += 1;
          controller.abort();
          return new Response(null, { status: 503 });
        }) as unknown as typeof fetch,
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(ExportError);
    expect(attempts).toBe(1);
  });
});
