import { describe, expect, test } from "bun:test";
import { ExportError, InvalidOptionsError } from "./errors.js";
import { extract, inject, Otel } from "./index.js";
import { HISTOGRAM_EXPLICIT_BOUNDS, TRACE_FLAG_SAMPLED } from "./types.js";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const createMockFetch = (status = 200) => {
  const calls: FetchCall[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const resolved =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    calls.push({ url: resolved, init });

    return new Response(null, { status });
  };

  return { fetch: mockFetch as typeof fetch, calls };
};

const createFailingPathFetch = (failPath: string) => {
  const calls: FetchCall[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const resolved =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    calls.push({ url: resolved, init });

    if (resolved.endsWith(failPath)) {
      return new Response(null, { status: 500 });
    }

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

const parseBody = (call: FetchCall | undefined) => {
  expect(call).toBeDefined();
  return JSON.parse(String(call?.init?.body));
};

const traceSpans = (calls: FetchCall[]) => {
  const call = calls.find((entry) => entry.url.endsWith("/v1/traces"));
  const body = parseBody(call);
  return body.resourceSpans[0].scopeSpans[0].spans as Array<{
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
    events: Array<{ name: string; attributes: unknown[] }>;
    status: { code: number; message?: string };
  }>;
};

describe("Otel constructor", () => {
  test("rejects empty serviceName", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        serviceName: "   ",
      });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects empty export url", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        export: { type: "otlp-http", url: " " },
      });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects sampleRatio below 0", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        sampleRatio: -0.1,
      });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects sampleRatio above 1", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        sampleRatio: 1.1,
      });
    }).toThrow(InvalidOptionsError);
  });

  test("includes service.version on resource attributes", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      serviceVersion: "1.2.3",
    });

    await otel.tracer("app").startActiveSpan("v", async () => {});
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const attrs = body.resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;

    expect(
      attrs.find((attr) => attr.key === "service.name")?.value.stringValue,
    ).toBe("test-svc");
    expect(
      attrs.find((attr) => attr.key === "service.version")?.value.stringValue,
    ).toBe("1.2.3");
  });
});

describe("Otel traces", () => {
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

    const spans = traceSpans(calls);
    expect(spans.length).toBe(2);

    const rootSpan = spans.find((span) => span.name === "root");
    const childSpan = spans.find((span) => span.name === "child");

    expect(rootSpan?.traceId).toBe(childSpan?.traceId);
    expect(childSpan?.parentSpanId).toBe(rootSpan?.spanId);
  });

  test("manual startSpan requires end to export", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const span = otel.tracer("app").startSpan("manual");

    await otel.flushAll();
    expect(calls.filter((call) => call.url.endsWith("/v1/traces")).length).toBe(
      0,
    );

    span.end();
    await otel.shutdown();

    const spans = traceSpans(calls);
    expect(spans.some((entry) => entry.name === "manual")).toBe(true);
  });

  test("double end exports the span once", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const span = otel.tracer("app").startSpan("once");
    span.end();
    span.end();
    await otel.shutdown();

    const spans = traceSpans(calls).filter((entry) => entry.name === "once");
    expect(spans.length).toBe(1);
  });

  test("records attributes events exception and status", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan("work", async (span) => {
      span.setAttribute("order.id", "o-1");
      span.setAttribute("retry", true);
      span.setAttribute("attempt", 2);
      span.addEvent("checkpoint", { step: "pay" });
      span.recordException(new Error("boom"));
      span.setStatus({ code: "ERROR", message: "charge failed" });
    });

    await otel.shutdown();

    const span = traceSpans(calls).find((entry) => entry.name === "work");
    expect(span).toBeDefined();

    const attrMap = Object.fromEntries(
      (span?.attributes ?? []).map((attr) => [attr.key, attr.value]),
    );

    expect(attrMap["order.id"]?.stringValue).toBe("o-1");
    expect(attrMap.retry?.boolValue).toBe(true);
    expect(attrMap.attempt?.intValue).toBe("2");
    expect(span?.events.some((event) => event.name === "exception")).toBe(true);
    expect(span?.events.some((event) => event.name === "checkpoint")).toBe(
      true,
    );
    expect(span?.status.code).toBe(2);
    expect(span?.status.message).toBe("charge failed");
  });

  test("supports fractional start and end times", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const tracer = otel.tracer("app");

    await tracer.startActiveSpan(
      "hr",
      async (span) => {
        span.end(1_700_000_000_000.25);
      },
      { startTime: 1_700_000_000_000.75 },
    );

    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const span = body.resourceSpans[0].scopeSpans[0].spans.find(
      (entry: { name: string }) => entry.name === "hr",
    ) as { startTimeUnixNano: string; endTimeUnixNano: string };

    expect(span.startTimeUnixNano.endsWith("750000")).toBe(true);
    expect(span.endTimeUnixNano.endsWith("250000")).toBe(true);
  });

  test("groups spans by instrumentation scope", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("a", "1").startActiveSpan("sa", async () => {});
    await otel.tracer("b", "2").startActiveSpan("sb", async () => {});
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const scopes = body.resourceSpans[0].scopeSpans as Array<{
      scope: { name: string; version?: string };
      spans: unknown[];
    }>;

    expect(scopes.length).toBe(2);
    expect(scopes.map((scope) => scope.scope.name).sort()).toEqual(["a", "b"]);
  });

  test("startActiveSpan rethrows callback errors after ending the span", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await expect(
      otel.tracer("app").startActiveSpan("fail", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    await otel.shutdown();
    expect(traceSpans(calls).some((span) => span.name === "fail")).toBe(true);
  });
});

describe("Otel sampling", () => {
  test("sampleRatio 0 drops root spans from export", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0,
    });

    await otel.tracer("app").startActiveSpan("dropped", async (span) => {
      span.setAttribute("x", 1);
    });

    await otel.shutdown();
    expect(calls.filter((call) => call.url.endsWith("/v1/traces")).length).toBe(
      0,
    );
  });

  test("child follows remote parent sampled flag when ratio is 0", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0,
    });

    const parent = extract({
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
    });

    await otel.tracer("app").startActiveSpan(
      "child",
      async (span) => {
        span.setAttribute("kept", true);
      },
      { parent },
    );

    await otel.shutdown();

    const spans = traceSpans(calls);
    expect(spans.length).toBe(1);
    expect(spans[0]?.traceId).toBe("a".repeat(32));
    expect(spans[0]?.parentSpanId).toBe("b".repeat(16));
  });

  test("child follows remote parent unsampled flag when ratio is 1", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 1,
    });

    const parent = extract({
      traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-00`,
    });

    await otel.tracer("app").startActiveSpan(
      "child",
      async (span) => {
        span.setAttribute("dropped", true);
      },
      { parent },
    );

    await otel.shutdown();
    expect(calls.filter((call) => call.url.endsWith("/v1/traces")).length).toBe(
      0,
    );
  });

  test("local child follows unsampled parent under ratio 1", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0,
    });

    const root = otel.tracer("app").startSpan("root");
    expect(root.context().traceFlags & TRACE_FLAG_SAMPLED).toBe(0);

    await otel.tracer("app").startActiveSpan("child", async () => {}, {
      parent: { span: root.context() },
    });

    root.end();
    await otel.shutdown();
    expect(calls.filter((call) => call.url.endsWith("/v1/traces")).length).toBe(
      0,
    );
  });

  test("fractional sampleRatio samples some roots and drops others", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0.5,
    });

    for (let index = 0; index < 40; index++) {
      await otel.tracer("app").startActiveSpan(`root-${index}`, async () => {});
    }

    await otel.shutdown();

    const traceCalls = calls.filter((call) => call.url.endsWith("/v1/traces"));
    expect(traceCalls.length).toBe(1);

    const spans = traceSpans(calls);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.length).toBeLessThan(40);
  });
});

describe("Otel metrics", () => {
  test("exports histogram counter and updowncounter bodies", async () => {
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

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics as Array<{
      name: string;
      sum?: { isMonotonic: boolean; dataPoints: Array<{ asDouble: number }> };
      histogram?: {
        dataPoints: Array<{
          count: string;
          explicitBounds: number[];
          bucketCounts: string[];
        }>;
      };
    }>;

    const names = metrics.map((metric) => metric.name);
    expect(names).toContain("orders.paid");
    expect(names).toContain("queue.depth");
    expect(names).toContain("charge.duration_ms");

    const counter = metrics.find((metric) => metric.name === "orders.paid");
    expect(counter?.sum?.isMonotonic).toBe(true);
    expect(counter?.sum?.dataPoints[0]?.asDouble).toBe(2);

    const updown = metrics.find((metric) => metric.name === "queue.depth");
    expect(updown?.sum?.isMonotonic).toBe(false);
    expect(updown?.sum?.dataPoints[0]?.asDouble).toBe(-1);

    const histogram = metrics.find(
      (metric) => metric.name === "charge.duration_ms",
    );
    expect(histogram?.histogram?.dataPoints[0]?.explicitBounds).toEqual([
      ...HISTOGRAM_EXPLICIT_BOUNDS,
    ]);
    expect(
      histogram?.histogram?.dataPoints[0]?.bucketCounts.every(
        (count) => typeof count === "string",
      ),
    ).toBe(true);
  });

  test("keeps cumulative metric values across flushes", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const counter = otel.meter("m").createCounter("hits");

    counter.add(1);
    await otel.flushAll();
    counter.add(2);
    await otel.flushAll();
    await otel.shutdown();

    const metricCalls = calls.filter((call) =>
      call.url.endsWith("/v1/metrics"),
    );
    expect(metricCalls.length).toBeGreaterThanOrEqual(2);

    const first = parseBody(metricCalls[0]);
    const second = parseBody(metricCalls[1]);

    const firstValue =
      first.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;
    const secondValue =
      second.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;

    expect(firstValue).toBe(1);
    expect(secondValue).toBe(3);
  });

  test("aggregates histogram observations into buckets", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const hist = otel.meter("m").createHistogram("latency");

    hist.record(3);
    hist.record(40);
    hist.record(2000);

    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const point =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram
        .dataPoints[0];

    expect(point.count).toBe("3");
    expect(point.sum).toBe(2043);
    expect(point.min).toBe(3);
    expect(point.max).toBe(2000);

    const counts = point.bucketCounts.map((value: string) => Number(value));
    expect(counts.reduce((sum: number, value: number) => sum + value, 0)).toBe(
      3,
    );
  });

  test("separates series by attribute sets", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const counter = otel.meter("m").createCounter("by_attr");

    counter.add(1, { route: "/a" });
    counter.add(2, { route: "/b" });
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const points =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints;

    expect(points.length).toBe(2);
  });
});

describe("Otel logs", () => {
  test("includes trace correlation from active span", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan("work", async () => {
      otel.logger("app").emit({
        severityText: "INFO",
        body: "hello",
        attributes: { attempt: 1 },
      });
    });

    await otel.shutdown();

    const body = parseBody(calls.find((call) => call.url.endsWith("/v1/logs")));
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(record.traceId).toBeDefined();
    expect(record.spanId).toBeDefined();
    expect(record.severityText).toBe("INFO");
    expect(record.body.stringValue).toBe("hello");
  });

  test("omits trace ids when no active span", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel.logger("app").emit({ severityText: "DEBUG", body: "alone" });
    await otel.shutdown();

    const body = parseBody(calls.find((call) => call.url.endsWith("/v1/logs")));
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(record.traceId).toBeUndefined();
    expect(record.spanId).toBeUndefined();
  });

  test("supports fractional log timestamps", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel.logger("app").emit({
      severityText: "INFO",
      body: "ts",
      timestamp: 1_700_000_000_000.5,
    });
    await otel.shutdown();

    const body = parseBody(calls.find((call) => call.url.endsWith("/v1/logs")));
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(String(record.timeUnixNano).endsWith("500000")).toBe(true);
  });
});

describe("W3C propagation", () => {
  test("inject and extract roundtrip on records", async () => {
    const { fetch } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan("propagate", async () => {
      const outbound: Record<string, string> = {};
      inject(outbound);

      expect(outbound.traceparent).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
      );

      const parent = extract(outbound);
      expect(parent.span).not.toBeNull();
      expect(parent.span?.isRemote).toBe(true);

      const parts = (outbound.traceparent ?? "").split("-");
      expect(parent.span?.traceId).toBe(parts[1]);
      expect(parent.span?.spanId).toBe(parts[2]);
    });

    await otel.shutdown();
  });

  test("inject and extract work with Headers", async () => {
    const { fetch } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan("headers", async () => {
      const headers = new Headers();
      inject(headers);
      expect(headers.get("traceparent")).toBeTruthy();

      const parent = extract(headers);
      expect(parent.span?.traceId).toHaveLength(32);
    });

    await otel.shutdown();
  });

  test("inject is a no-op without active span", () => {
    const carrier: Record<string, string> = {};
    inject(carrier);
    expect(carrier.traceparent).toBeUndefined();
  });

  test("extract rejects missing header", () => {
    expect(extract({}).span).toBeNull();
    expect(extract(new Headers()).span).toBeNull();
  });

  test("extract rejects wrong version", () => {
    expect(
      extract({
        traceparent: `01-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      }).span,
    ).toBeNull();
  });

  test("extract rejects wrong part count", () => {
    expect(extract({ traceparent: "00-abc" }).span).toBeNull();
  });

  test("extract rejects short ids", () => {
    expect(
      extract({
        traceparent: `00-${"a".repeat(31)}-${"b".repeat(16)}-01`,
      }).span,
    ).toBeNull();
    expect(
      extract({
        traceparent: `00-${"a".repeat(32)}-${"b".repeat(15)}-01`,
      }).span,
    ).toBeNull();
  });

  test("extract rejects all-zero trace and span ids", () => {
    expect(
      extract({
        traceparent: `00-${"0".repeat(32)}-${"b".repeat(16)}-01`,
      }).span,
    ).toBeNull();
    expect(
      extract({
        traceparent: `00-${"a".repeat(32)}-${"0".repeat(16)}-01`,
      }).span,
    ).toBeNull();
  });

  test("extract rejects non-hex flags", () => {
    expect(
      extract({
        traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-0g`,
      }).span,
    ).toBeNull();
  });

  test("extract rejects non-hex ids", () => {
    expect(
      extract({
        traceparent: `00-${"g".repeat(32)}-${"b".repeat(16)}-01`,
      }).span,
    ).toBeNull();
  });
});

describe("Otel lifecycle and export", () => {
  test("enabled false performs no fetch", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      enabled: false,
    });

    await otel.tracer("app").startActiveSpan("noop", async (span) => {
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

    await otel.tracer("app").startActiveSpan("once", async () => {
      otel.logger("app").emit({ severityText: "WARN", body: "flush-me" });
    });

    await otel.shutdown();
    const afterFirst = calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await otel.shutdown();
    await otel.tracer("app").startActiveSpan("after-shutdown", async (span) => {
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

    const headers = calls.find((call) => call.url.endsWith("/v1/traces"))?.init
      ?.headers as Record<string, string>;

    expect(headers[authHeader]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("strips trailing slash from export url", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      export: { type: "otlp-http", url: "http://collector:4318/" },
    });

    await otel.tracer("app").startActiveSpan("slash", async () => {});
    await otel.shutdown();

    expect(
      calls.some((call) => call.url === "http://collector:4318/v1/traces"),
    ).toBe(true);
  });

  test("failed traces export still attempts logs export", async () => {
    const { fetch, calls } = createFailingPathFetch("/v1/traces");
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan("both", async () => {
      otel.logger("app").emit({ severityText: "ERROR", body: "keep-me" });
    });

    await expect(otel.shutdown()).rejects.toBeInstanceOf(ExportError);

    expect(calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(true);
  });

  test("failed metrics export throws ExportError", async () => {
    const { fetch } = createFailingPathFetch("/v1/metrics");
    const otel = new Otel(baseOptions(fetch));
    otel.meter("m").createCounter("c").add(1);

    await expect(otel.flushAll()).rejects.toBeInstanceOf(ExportError);
    await expect(otel.shutdown()).rejects.toBeInstanceOf(ExportError);
  });

  test("periodic flush failures call onExportError", async () => {
    const errors: Error[] = [];
    const { fetch } = createFailingPathFetch("/v1/traces");
    const otel = new Otel({
      ...baseOptions(fetch),
      flushIntervalMs: 20,
      onExportError: (error) => {
        errors.push(error);
      },
    });

    await otel.tracer("app").startActiveSpan("x", async () => {});
    await Bun.sleep(80);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBeInstanceOf(ExportError);

    await otel.shutdown().catch(() => undefined);
  });

  test("flushAll with empty buffers is a no-op", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    await otel.flushAll();
    expect(calls.length).toBe(0);
    await otel.shutdown();
  });
});
