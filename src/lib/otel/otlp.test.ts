import { describe, expect, test } from "bun:test";
import {
  encodeAttributes,
  encodeAttributeValue,
  encodeLogRecord,
  encodeLogsExport,
  encodeMetric,
  encodeMetricsExport,
  encodeSpan,
  encodeTracesExport,
  otlpPost,
} from "./otlp.js";
import type {
  FinishedSpan,
  MetricPoint,
  PendingLogRecord,
  Resource,
} from "./types.js";
import { HISTOGRAM_EXPLICIT_BOUNDS } from "./types.js";

const resource: Resource = {
  attributes: {
    "service.name": "encode-svc",
    "service.version": "9",
  },
};

const sampleSpan = (overrides: Partial<FinishedSpan> = {}): FinishedSpan => ({
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  parentSpanId: "c".repeat(16),
  name: "op",
  kind: 1,
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

describe("otlp encodeAttributeValue", () => {
  test("encodes string boolean int double and arrays", () => {
    expect(encodeAttributeValue("x")).toEqual({ stringValue: "x" });
    expect(encodeAttributeValue(true)).toEqual({ boolValue: true });
    expect(encodeAttributeValue(4)).toEqual({ intValue: "4" });
    expect(encodeAttributeValue(1.5)).toEqual({ doubleValue: 1.5 });
    expect(encodeAttributeValue(["a", "b"])).toEqual({
      arrayValue: {
        values: [{ stringValue: "a" }, { stringValue: "b" }],
      },
    });
    expect(encodeAttributeValue([1, 2])).toEqual({
      arrayValue: {
        values: [{ intValue: "1" }, { intValue: "2" }],
      },
    });
    expect(encodeAttributeValue([true, false])).toEqual({
      arrayValue: {
        values: [{ boolValue: true }, { boolValue: false }],
      },
    });
  });
});

describe("otlp encodeAttributes", () => {
  test("sorts keys and skips undefined values", () => {
    const attrs = encodeAttributes({
      b: "2",
      a: "1",
    });

    expect(attrs.map((pair) => pair.key)).toEqual(["a", "b"]);
  });
});

describe("otlp encodeSpan and traces export", () => {
  test("includes parent status message and events", () => {
    const encoded = encodeSpan(sampleSpan());

    expect(encoded.parentSpanId).toBe("c".repeat(16));
    expect(encoded.status).toEqual({ code: 2, message: "failed" });
    expect((encoded.events as unknown[]).length).toBe(1);
  });

  test("omits parent and status message when absent", () => {
    const encoded = encodeSpan(
      sampleSpan({
        parentSpanId: undefined,
        status: { code: "OK" },
      }),
    );

    expect(encoded.parentSpanId).toBeUndefined();
    expect(encoded.status).toEqual({ code: 1 });
  });

  test("maps unset status to code 0", () => {
    const encoded = encodeSpan(sampleSpan({ status: { code: "UNSET" } }));
    expect(encoded.status).toEqual({ code: 0 });
  });

  test("encodeTracesExport wraps resource and scopes", () => {
    const body = encodeTracesExport(resource, [
      {
        scope: { scopeName: "api", scopeVersion: "2" },
        spans: [sampleSpan({ name: "one" })],
      },
    ]);

    expect(body.resourceSpans).toHaveLength(1);
    expect(body.resourceSpans[0]?.scopeSpans[0]?.scope).toEqual({
      name: "api",
      version: "2",
    });
    expect(body.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe("one");
  });
});

describe("otlp encode logs", () => {
  test("includes optional trace ids", () => {
    const record: PendingLogRecord = {
      timeUnixNano: "10",
      severityText: "INFO",
      body: "hi",
      attributes: { k: "v" },
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      scopeName: "log",
    };

    const encoded = encodeLogRecord(record);
    expect(encoded.traceId).toBe("a".repeat(32));
    expect(encoded.spanId).toBe("b".repeat(16));
    expect(encoded.body).toEqual({ stringValue: "hi" });
  });

  test("omits missing trace ids", () => {
    const encoded = encodeLogRecord({
      timeUnixNano: "10",
      severityText: "WARN",
      body: "x",
      attributes: {},
      scopeName: "log",
    });

    expect(encoded.traceId).toBeUndefined();
    expect(encoded.spanId).toBeUndefined();
  });

  test("encodeLogsExport wraps resource and scopes", () => {
    const body = encodeLogsExport(resource, [
      {
        scope: { scopeName: "logs" },
        logRecords: [
          {
            timeUnixNano: "1",
            severityText: "ERROR",
            body: "e",
            attributes: {},
            scopeName: "logs",
          },
        ],
      },
    ]);

    expect(body.resourceLogs[0]?.scopeLogs[0]?.logRecords).toHaveLength(1);
  });
});

describe("otlp encode metrics", () => {
  test("encodes monotonic counter sums", () => {
    const point: MetricPoint = {
      name: "hits",
      kind: "counter",
      scopeName: "m",
      dataPoints: [
        {
          attributes: { route: "/" },
          startTimeUnixNano: "1",
          timeUnixNano: "2",
          value: 4,
        },
      ],
    };

    const encoded = encodeMetric(point);
    expect(encoded.sum?.isMonotonic).toBe(true);
    expect(encoded.sum?.dataPoints[0]?.asDouble).toBe(4);
  });

  test("encodes non-monotonic updowncounter", () => {
    const encoded = encodeMetric({
      name: "depth",
      kind: "updowncounter",
      scopeName: "m",
      dataPoints: [
        {
          attributes: {},
          timeUnixNano: "2",
          value: -3,
        },
      ],
    });

    expect(encoded.sum?.isMonotonic).toBe(false);
  });

  test("encodes histogram with string bucket counts", () => {
    const encoded = encodeMetric({
      name: "latency",
      kind: "histogram",
      scopeName: "m",
      dataPoints: [
        {
          attributes: {},
          startTimeUnixNano: "1",
          timeUnixNano: "2",
          value: 10,
          count: 2,
          sum: 10,
          min: 1,
          max: 9,
          bucketCounts: [1, 0, 1],
          explicitBounds: [...HISTOGRAM_EXPLICIT_BOUNDS].slice(0, 2),
        },
      ],
    });

    expect(encoded.histogram?.dataPoints[0]?.count).toBe("2");
    expect(encoded.histogram?.dataPoints[0]?.bucketCounts).toEqual([
      "1",
      "0",
      "1",
    ]);
  });

  test("encodeMetricsExport wraps resource and scopes", () => {
    const body = encodeMetricsExport(resource, [
      {
        scope: { scopeName: "metrics" },
        metrics: [
          {
            name: "c",
            kind: "counter",
            scopeName: "metrics",
            dataPoints: [
              {
                attributes: {},
                timeUnixNano: "1",
                value: 1,
              },
            ],
          },
        ],
      },
    ]);

    expect(body.resourceMetrics[0]?.scopeMetrics[0]?.metrics).toHaveLength(1);
  });
});

describe("otlpPost", () => {
  test("posts json with content type and timeout signal", async () => {
    let seen: RequestInit | undefined;

    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      seen = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await otlpPost({
      baseUrl: "http://collector:4318/",
      path: "/v1/traces",
      body: { ok: true },
      fetch: fetchImpl,
      headers: { "x-test": "1" },
    });

    expect(seen?.method).toBe("POST");
    expect(seen?.body).toBe(JSON.stringify({ ok: true }));
    expect(seen?.signal).toBeInstanceOf(AbortSignal);

    const headers = seen?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-test"]).toBe("1");
  });

  test("throws on non-2xx", async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 503 })) as unknown as typeof fetch;

    await expect(
      otlpPost({
        baseUrl: "http://collector:4318",
        path: "/v1/logs",
        body: {},
        fetch: fetchImpl,
      }),
    ).rejects.toThrow("OTLP export failed with status 503");
  });

  test("accepts 204 no content", async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 204 })) as unknown as typeof fetch;

    await otlpPost({
      baseUrl: "http://collector:4318",
      path: "/v1/metrics",
      body: {},
      fetch: fetchImpl,
    });
  });
});
