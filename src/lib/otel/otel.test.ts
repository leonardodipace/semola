import { describe, expect, test } from "bun:test";
import { ExportError, InvalidOptionsError } from "./errors.js";
import { Otel } from "./otel.js";
import {
  baseOptions,
  createMockFetch,
  type FetchCall,
  parseBody,
  resolveUrl,
} from "./test-fixtures.js";
import { TRACE_FLAG_SAMPLED } from "./types.js";

describe("Otel constructor", () => {
  test("rejects empty serviceName", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({ ...baseOptions(fetch), serviceName: "  " });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects empty export url", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        export: { type: "otlp-http", url: "" },
      });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects whitespace-only export url", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        export: { type: "otlp-http", url: " " },
      });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects sampleRatio outside 0..1", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({ ...baseOptions(fetch), sampleRatio: -0.1 });
    }).toThrow(InvalidOptionsError);
    expect(() => {
      new Otel({ ...baseOptions(fetch), sampleRatio: 1.1 });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects flushIntervalMs below 1", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({ ...baseOptions(fetch), flushIntervalMs: 0 });
    }).toThrow(InvalidOptionsError);
  });
});

describe("Otel resource and factories", () => {
  test("includes service version and instance id on resource", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      serviceVersion: "9.0.0",
      serviceInstanceId: "node-1",
    });

    await otel.tracer("app").startActiveSpan("x", async () => {});
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const attrs = body.resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;

    expect(
      attrs.find((attr) => attr.key === "service.version")?.value.stringValue,
    ).toBe("9.0.0");
    expect(
      attrs.find((attr) => attr.key === "service.instance.id")?.value
        .stringValue,
    ).toBe("node-1");
  });

  test("tracer meter and logger share recording path", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("t").startActiveSpan("span", async () => {
      otel.meter("m").createCounter("c").add(1);
      otel.logger("l").emit({ severityText: "INFO", body: "hi" });
    });
    await otel.shutdown();

    expect(calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/metrics"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(true);
  });
});

describe("Otel lifecycle", () => {
  test("enabled false performs no fetch", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({ ...baseOptions(fetch), enabled: false });

    await otel.tracer("t").startActiveSpan("x", async () => {});
    otel.meter("m").createCounter("c").add(1);
    otel.logger("l").emit({ severityText: "INFO", body: "x" });
    await otel.shutdown();

    expect(calls.length).toBe(0);
  });

  test("successful shutdown is idempotent", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("t").startActiveSpan("x", async () => {});
    await otel.shutdown();
    const afterFirst = calls.length;
    await otel.shutdown();
    expect(calls.length).toBe(afterFirst);
  });

  test("failed shutdown can retry after collector recovers", async () => {
    let fail = true;
    const calls: FetchCall[] = [];

    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      calls.push({ url: resolved, init });

      if (fail && resolved.endsWith("/v1/traces")) {
        return new Response(null, { status: 500 });
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel(baseOptions(fetchImpl as typeof fetch));
    await otel.tracer("t").startActiveSpan("retry", async () => {});
    await expect(otel.shutdown()).rejects.toBeInstanceOf(ExportError);

    fail = false;
    await otel.shutdown();

    expect(
      calls.filter((call) => call.url.endsWith("/v1/traces")).length,
    ).toBeGreaterThan(1);
  });

  test("shutdown retries within timeout until collector recovers", async () => {
    let attempts = 0;

    const fetchImpl = async (
      url: string | URL | Request,
      _init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);

      if (resolved.endsWith("/v1/traces")) {
        attempts += 1;

        if (attempts < 4) {
          return new Response(null, { status: 503 });
        }
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel({
      ...baseOptions(fetchImpl as typeof fetch),
      shutdownTimeoutMs: 2_000,
    });

    await otel.tracer("t").startActiveSpan("patient", async () => {});
    await otel.shutdown();

    expect(attempts).toBeGreaterThanOrEqual(4);
  });

  test("rejects negative shutdownTimeoutMs", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        shutdownTimeoutMs: -1,
      });
    }).toThrow(InvalidOptionsError);
  });

  test("flushAll with empty buffers is a no-op", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    await otel.flushAll();
    expect(calls.length).toBe(0);
    await otel.shutdown();
  });

  test("shouldRecordTrace follows parent sampled flag", () => {
    const { fetch } = createMockFetch();
    const otel = new Otel({ ...baseOptions(fetch), sampleRatio: 0 });

    expect(
      otel.shouldRecordTrace("a".repeat(32), {
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        traceFlags: TRACE_FLAG_SAMPLED,
      }),
    ).toBe(true);

    expect(otel.shouldRecordTrace("a".repeat(32), null)).toBe(false);
  });
});
