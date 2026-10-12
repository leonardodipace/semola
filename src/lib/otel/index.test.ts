import { describe, expect, test } from "bun:test";
import { extract, inject, Otel } from "./index.js";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const createMockFetch = () => {
  const calls: FetchCall[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const resolved =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    calls.push({ url: resolved, init });

    return new Response(null, { status: 200 });
  };

  return { fetch: mockFetch as typeof fetch, calls };
};

const baseOptions = (fetchImpl: typeof fetch) => ({
  serviceName: "test-svc",
  export: { type: "otlp-http" as const, url: "http://collector:4318" },
  sampleRatio: 1,
  enabled: true,
  flushIntervalMs: 60_000,
  fetch: fetchImpl,
});

describe("Otel", () => {
  test("nested spans share trace id and set parent span id", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const tracer = otel.tracer("app");

    await tracer.startActiveSpan("root", async (root) => {
      root.setAttribute("layer", "root");

      await tracer.startActiveSpan("child", async (child) => {
        child.setAttribute("layer", "child");
      });
    });

    await otel.shutdown();

    expect(calls.length).toBeGreaterThan(0);

    const traceCall = calls.find((call) => call.url.endsWith("/v1/traces"));
    expect(traceCall).toBeDefined();

    const body = JSON.parse(String(traceCall?.init?.body));
    const spans = body.resourceSpans[0].scopeSpans[0].spans;

    expect(spans.length).toBe(2);

    const rootSpan = spans.find(
      (span: { name: string }) => span.name === "root",
    );
    const childSpan = spans.find(
      (span: { name: string }) => span.name === "child",
    );

    expect(rootSpan.traceId).toBe(childSpan.traceId);
    expect(childSpan.parentSpanId).toBe(rootSpan.spanId);
  });

  test("metrics export histogram and counter bodies", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const meter = otel.meter("metrics");

    meter.createCounter("orders.paid").add(2, { currency: "USD" });
    meter.createUpDownCounter("queue.depth").add(-1);
    meter
      .createHistogram("charge.duration_ms")
      .record(12, { region: "us-east" });

    await otel.flushAll();
    await otel.shutdown();

    const metricsCall = calls.find((call) => call.url.endsWith("/v1/metrics"));
    expect(metricsCall).toBeDefined();

    const body = JSON.parse(String(metricsCall?.init?.body));
    const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
    const names = metrics.map((metric: { name: string }) => metric.name);

    expect(names).toContain("orders.paid");
    expect(names).toContain("queue.depth");
    expect(names).toContain("charge.duration_ms");

    const histogram = metrics.find(
      (metric: { name: string }) => metric.name === "charge.duration_ms",
    );

    expect(histogram.histogram).toBeDefined();
    expect(
      histogram.histogram.dataPoints[0].explicitBounds.length,
    ).toBeGreaterThan(0);
  });

  test("logs include trace correlation from active span", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const tracer = otel.tracer("app");

    await tracer.startActiveSpan("work", async () => {
      otel.logger("app").emit({
        severityText: "INFO",
        body: "hello",
      });
    });

    await otel.shutdown();

    const logsCall = calls.find((call) => call.url.endsWith("/v1/logs"));
    expect(logsCall).toBeDefined();

    const body = JSON.parse(String(logsCall?.init?.body));
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(record.traceId).toBeDefined();
    expect(record.spanId).toBeDefined();
    expect(record.severityText).toBe("INFO");
  });

  test("W3C inject and extract roundtrip", async () => {
    const { fetch } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const tracer = otel.tracer("app");

    await tracer.startActiveSpan("propagate", async () => {
      const outbound: Record<string, string> = {};
      inject(outbound);

      expect(outbound.traceparent).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
      );

      const parent = extract(outbound);
      expect(parent.span).not.toBeNull();
      expect(parent.span?.isRemote).toBe(true);

      const traceparent = outbound.traceparent ?? "";
      const parts = traceparent.split("-");
      expect(parent.span?.traceId).toBe(parts[1]);
      expect(parent.span?.spanId).toBe(parts[2]);
    });

    await otel.shutdown();
  });

  test("enabled false performs no fetch", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      enabled: false,
    });

    const tracer = otel.tracer("app");
    await tracer.startActiveSpan("noop", async (span) => {
      span.setAttribute("x", 1);
    });

    otel.logger("app").emit({ severityText: "INFO", body: "x" });
    otel.meter("m").createCounter("c").add(1);

    await otel.shutdown();

    expect(calls.length).toBe(0);
  });

  test("shutdown flushes and second shutdown is idempotent", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const tracer = otel.tracer("app");

    await tracer.startActiveSpan("once", async () => {
      otel.logger("app").emit({ severityText: "WARN", body: "flush-me" });
    });

    await otel.shutdown();
    const afterFirst = calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await otel.shutdown();

    await tracer.startActiveSpan("after-shutdown", async (span) => {
      span.setAttribute("ignored", true);
    });

    expect(calls.length).toBe(afterFirst);
  });

  test("export headers are sent on OTLP posts", async () => {
    const { fetch, calls } = createMockFetch();
    const authHeader = "Authorization";
    const otel = new Otel({
      ...baseOptions(fetch),
      export: {
        type: "otlp-http",
        url: "http://collector:4318",
        headers: { [authHeader]: "Bearer test-token" },
      },
    });

    await otel.tracer("app").startActiveSpan("h", async () => {});
    await otel.shutdown();

    const traceCall = calls.find((call) => call.url.endsWith("/v1/traces"));
    const headers = traceCall?.init?.headers as Record<string, string>;

    expect(headers[authHeader]).toBe("Bearer test-token");
  });
});
