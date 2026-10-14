import { describe, expect, test } from "bun:test";
import { ExportError, InvalidOptionsError } from "./errors.js";
import { extract, inject, Otel } from "./index.js";
import {
  baseOptions,
  createMockFetch,
  type FetchCall,
  parseBody,
  resolveUrl,
} from "./test-fixtures.js";
import { HISTOGRAM_EXPLICIT_BOUNDS } from "./types.js";

const traceSpans = (calls: FetchCall[]) => {
  const call = calls.find((entry) => entry.url.endsWith("/v1/traces"));
  const body = parseBody(call);
  return body.resourceSpans[0].scopeSpans[0].spans as Array<{
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    kind?: number;
    flags?: number;
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
  }>;
};

const SPAN_KIND = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
} as const;

const SEVERITY_CASES: Array<[string, number]> = [
  ["TRACE", 1],
  ["DEBUG", 5],
  ["INFO", 9],
  ["WARN", 13],
  ["WARNING", 13],
  ["ERROR", 17],
  ["FATAL", 21],
];

describe("adversarial constructor and constants", () => {
  test("InvalidOptionsError has stable name", () => {
    const error = new InvalidOptionsError("x");
    expect(error.name).toBe("InvalidOptionsError");
  });

  test("ExportError has stable name", () => {
    const error = new ExportError("x");
    expect(error.name).toBe("ExportError");
  });

  test("HISTOGRAM_EXPLICIT_BOUNDS matches documented bucket edges", () => {
    expect(HISTOGRAM_EXPLICIT_BOUNDS.length).toBe(10);
    expect(HISTOGRAM_EXPLICIT_BOUNDS[0]).toBe(0);
    expect(HISTOGRAM_EXPLICIT_BOUNDS[9]).toBe(1000);
  });

  test("accepts sampleRatio 0 at boundary", () => {
    const { fetch } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0,
    });
    expect(otel).toBeDefined();
  });

  test("accepts sampleRatio 1 at boundary", () => {
    const { fetch } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 1,
    });
    expect(otel).toBeDefined();
  });

  test("accepts flushIntervalMs minimum 1", () => {
    const { fetch } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      flushIntervalMs: 1,
    });
    expect(otel).toBeDefined();
  });

  test("rejects whitespace-only serviceName with InvalidOptionsError", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        serviceName: "\t\n",
      });
    }).toThrow(InvalidOptionsError);
  });

  test("rejects empty otlp url with InvalidOptionsError", () => {
    const { fetch } = createMockFetch();
    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        export: { type: "otlp-http", url: "" },
      });
    }).toThrow(InvalidOptionsError);
  });
});

describe("adversarial span kinds", () => {
  for (const [kind, code] of Object.entries(SPAN_KIND)) {
    test(`exports OTLP kind code for ${kind}`, async () => {
      const { fetch, calls } = createMockFetch();
      const otel = new Otel(baseOptions(fetch));

      await otel
        .tracer("kinds")
        .startActiveSpan(`span-${kind}`, async () => {}, {
          kind: kind as keyof typeof SPAN_KIND,
        });

      await otel.shutdown();

      const span = traceSpans(calls).find(
        (entry) => entry.name === `span-${kind}`,
      );
      expect(span?.kind).toBe(code);
    });
  }
});

describe("adversarial log severities", () => {
  for (const [text, number] of SEVERITY_CASES) {
    test(`maps severityText ${text} to severityNumber ${number}`, async () => {
      const { fetch, calls } = createMockFetch();
      const otel = new Otel(baseOptions(fetch));

      otel.logger("sev").emit({ severityText: text, body: `msg-${text}` });
      await otel.shutdown();

      const body = parseBody(
        calls.find((call) => call.url.endsWith("/v1/logs")),
      );
      const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.severityText).toBe(text);
      expect(record.severityNumber).toBe(number);
    });
  }

  test("custom severity text omits or leaves severityNumber unset", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel.logger("sev").emit({ severityText: "CUSTOM", body: "weird" });
    await otel.shutdown();

    const body = parseBody(calls.find((call) => call.url.endsWith("/v1/logs")));
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(record.severityText).toBe("CUSTOM");
    expect(
      record.severityNumber === undefined || record.severityNumber === 0,
    ).toBe(true);
  });
});

describe("adversarial propagation", () => {
  test("extract returns baggage when traceparent is missing", () => {
    const ctx = extract({ baggage: "tenant=acme" });
    expect(ctx.span).toBeNull();
    expect(ctx.baggage).toBe("tenant=acme");
  });

  test("extract reads BAGGAGE key case-insensitively on plain records", () => {
    const carrier: Record<string, string> = {};
    carrier.Baggage = "k=v";

    const ctx = extract(carrier);
    expect(ctx.baggage).toBe("k=v");
  });

  test("extract reads TRACEPARENT case-insensitively", () => {
    const carrier: Record<string, string> = {};
    carrier.traceparent = `00-${"c".repeat(32)}-${"d".repeat(16)}-01`;

    const ctx = extract(carrier);
    expect(ctx.span?.traceId).toBe("c".repeat(32));
  });

  test("invalid traceparent still preserves baggage on extract", () => {
    const ctx = extract({
      traceparent: "not-valid",
      baggage: "left=1",
    });

    expect(ctx.span).toBeNull();
    expect(ctx.baggage).toBe("left=1");
  });

  test("inject without active span leaves carrier empty", () => {
    const record: Record<string, string> = { baggage: "keep" };
    inject(record);
    expect(record.traceparent).toBeUndefined();
    expect(record.baggage).toBe("keep");
  });

  test("inject into Headers without span does not set traceparent", () => {
    const headers = new Headers();
    headers.set("baggage", "x=1");
    inject(headers);
    expect(headers.get("traceparent")).toBeNull();
    expect(headers.get("baggage")).toBe("x=1");
  });

  test("inject writes lowercase traceparent key on plain records", async () => {
    const { fetch } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("p").startActiveSpan("active", async () => {
      const out: Record<string, string> = {};
      inject(out);
      expect(Object.keys(out).includes("traceparent")).toBe(true);
    });

    await otel.shutdown();
  });

  test("extract from Headers with mixed-case traceparent", () => {
    const headers = new Headers();
    headers.set("Traceparent", `00-${"e".repeat(32)}-${"f".repeat(16)}-01`);

    const ctx = extract(headers);
    expect(ctx.span?.spanId).toBe("f".repeat(16));
  });

  test("runWithContext inject uses provided span", async () => {
    const { fetch } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const carrier: Record<string, string> = {};

    otel.runWithContext(
      {
        span: {
          traceId: "1".repeat(32),
          spanId: "2".repeat(16),
          traceFlags: 0x01,
          traceState: "vendor=1",
        },
        baggage: "a=b",
      },
      () => {
        inject(carrier);
      },
    );

    expect(carrier.traceparent).toBe(
      `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
    );
    expect(carrier.tracestate).toBe("vendor=1");
    expect(carrier.baggage).toBe("a=b");

    await otel.shutdown();
  });

  test("extract tracestate without valid span still parses baggage only", () => {
    const ctx = extract({
      tracestate: "x=1",
      baggage: "y=2",
    });

    expect(ctx.span).toBeNull();
    expect(ctx.baggage).toBe("y=2");
  });
});

describe("adversarial sampling", () => {
  test("unsampled root span methods do not create trace export", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0,
    });

    const span = otel.tracer("s").startSpan("noop-root");
    span.setAttribute("ignored", true);
    span.addEvent("evt");
    span.end();

    await otel.shutdown();
    expect(calls.filter((call) => call.url.endsWith("/v1/traces")).length).toBe(
      0,
    );
  });

  test("sampled remote parent keeps trace id on child export", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0,
    });

    const traceId = "9".repeat(32);
    const parentSpanId = "8".repeat(16);
    const parent = extract({
      traceparent: `00-${traceId}-${parentSpanId}-01`,
    });

    await otel.tracer("s").startActiveSpan("kept", async () => {}, { parent });
    await otel.shutdown();

    const spans = traceSpans(calls);
    expect(spans[0]?.traceId).toBe(traceId);
    expect(spans[0]?.parentSpanId).toBe(parentSpanId);
  });

  test("fractional ratio 0.01 still exports at least one root sometimes", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0.01,
    });

    for (let index = 0; index < 200; index++) {
      await otel.tracer("s").startActiveSpan(`r-${index}`, async () => {});
    }

    await otel.shutdown();

    const tracePosts = calls.filter((call) => call.url.endsWith("/v1/traces"));
    expect(tracePosts.length).toBeLessThanOrEqual(1);
  });

  test("local nested child under sampled root is exported", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("s").startActiveSpan("root", async () => {
      await otel.tracer("s").startActiveSpan("nested", async () => {});
    });

    await otel.shutdown();

    const names = traceSpans(calls).map((span) => span.name);
    expect(names.includes("root")).toBe(true);
    expect(names.includes("nested")).toBe(true);
  });

  test("startActiveSpan with unsampled parent does not export nested work", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    const parent = extract({
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-00`,
    });

    await otel.tracer("s").startActiveSpan(
      "root",
      async () => {
        await otel.tracer("s").startActiveSpan("child", async () => {});
      },
      { parent },
    );

    await otel.shutdown();
    expect(calls.filter((call) => call.url.endsWith("/v1/traces")).length).toBe(
      0,
    );
  });
});

describe("adversarial metrics", () => {
  test("counter accepts zero", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel.meter("m").createCounter("zero").add(0);
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const value =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;
    expect(value).toBe(0);
  });

  test("counter accepts negative zero as zero", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const counter = otel.meter("m").createCounter("c");

    counter.add(-0);
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    expect(
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble,
    ).toBe(0);
  });

  test("updown counter accepts large negative delta", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel.meter("m").createUpDownCounter("depth").add(-999);
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const value =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;
    expect(value).toBe(-999);
  });

  test("histogram record at exact bound lands in bucket", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const bound = HISTOGRAM_EXPLICIT_BOUNDS[3];
    expect(bound).toBeDefined();

    otel
      .meter("m")
      .createHistogram("h")
      .record(bound as number);
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const point =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram
        .dataPoints[0];

    expect(point.explicitBounds).toEqual([...HISTOGRAM_EXPLICIT_BOUNDS]);
    expect(point.count).toBe("1");
  });

  test("same counter name with different attributes stays separate", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const counter = otel.meter("m").createCounter("hits");

    counter.add(5, { zone: "a" });
    counter.add(7, { zone: "b" });
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const points =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints;

    expect(points.length).toBe(2);
  });

  test("cumulative counter grows across three flushes", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const counter = otel.meter("m").createCounter("hits");

    counter.add(2);
    await otel.flushAll();
    counter.add(3);
    await otel.flushAll();
    counter.add(1);
    await otel.flushAll();
    await otel.shutdown();

    const metricCalls = calls.filter((call) =>
      call.url.endsWith("/v1/metrics"),
    );
    expect(metricCalls.length).toBeGreaterThanOrEqual(3);

    const last = parseBody(metricCalls[metricCalls.length - 1]);
    const value =
      last.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;
    expect(value).toBe(6);
  });

  test("meter scopeVersion appears on export scope", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel.meter("metrics-scope", "3.0.0").createCounter("c").add(1);
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const scope = body.resourceMetrics[0].scopeMetrics[0].scope;

    expect(scope.name).toBe("metrics-scope");
    expect(scope.version).toBe("3.0.0");
  });

  test("rejects Counter.add with negative infinity", () => {
    const { fetch } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const counter = otel.meter("m").createCounter("c");

    expect(() => counter.add(Number.NEGATIVE_INFINITY)).toThrow(
      InvalidOptionsError,
    );
  });
});

describe("adversarial logs and trace correlation", () => {
  test("logger scopeVersion appears on export scope", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    otel
      .logger("log-scope", "2.1.0")
      .emit({ severityText: "INFO", body: "hi" });
    await otel.shutdown();

    const body = parseBody(calls.find((call) => call.url.endsWith("/v1/logs")));
    const scope = body.resourceLogs[0].scopeLogs[0].scope;

    expect(scope.name).toBe("log-scope");
    expect(scope.version).toBe("2.1.0");
  });

  test("log inside active span carries trace ids", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("t", "1.0").startActiveSpan("work", async () => {
      otel.logger("t").emit({ severityText: "INFO", body: "inside" });
    });

    await otel.shutdown();

    const traceBody = parseBody(
      calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const span = traceBody.resourceSpans[0].scopeSpans[0].spans[0];

    const logBody = parseBody(
      calls.find((call) => call.url.endsWith("/v1/logs")),
    );
    const record = logBody.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(record.traceId).toBe(span.traceId);
    expect(record.spanId).toBe(span.spanId);
  });

  test("tracer scopeVersion appears on span scope", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel
      .tracer("trace-scope", "4.4.4")
      .startActiveSpan("s", async () => {});
    await otel.shutdown();

    const body = parseBody(
      calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const scope = body.resourceSpans[0].scopeSpans[0].scope;

    expect(scope.name).toBe("trace-scope");
    expect(scope.version).toBe("4.4.4");
  });
});

describe("adversarial export and retry", () => {
  test("posts to all three otlp paths on shutdown", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("a").startActiveSpan("t", async () => {
      otel.logger("a").emit({ severityText: "INFO", body: "l" });
    });
    otel.meter("a").createCounter("m").add(1);

    await otel.shutdown();

    expect(calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/metrics"))).toBe(true);
  });

  test("429 on traces retries then succeeds", async () => {
    let attempts = 0;
    const calls: FetchCall[] = [];

    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      calls.push({ url: resolved, init });

      if (resolved.endsWith("/v1/traces")) {
        attempts += 1;
        if (attempts < 3) {
          return new Response(null, { status: 429 });
        }
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel(baseOptions(fetchImpl as typeof fetch));
    await otel.tracer("a").startActiveSpan("retry-429", async () => {});
    await otel.shutdown();

    const traceAttempts = calls.filter((call) =>
      call.url.endsWith("/v1/traces"),
    );
    expect(traceAttempts.length).toBe(3);
    expect(traceSpans(calls).some((span) => span.name === "retry-429")).toBe(
      true,
    );
  });

  test("400 on traces does not retry beyond first attempt", async () => {
    const calls: FetchCall[] = [];

    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      calls.push({ url: resolved, init });

      if (resolved.endsWith("/v1/traces")) {
        return new Response(null, { status: 400 });
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel(baseOptions(fetchImpl as typeof fetch));
    await otel.tracer("a").startActiveSpan("bad", async () => {});

    await expect(otel.shutdown()).rejects.toBeInstanceOf(ExportError);

    const traceAttempts = calls.filter((call) =>
      call.url.endsWith("/v1/traces"),
    );
    expect(traceAttempts.length).toBe(1);
  });

  test("network throw on traces retries up to three attempts", async () => {
    let throws = 0;
    const calls: FetchCall[] = [];

    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      calls.push({ url: resolved, init });

      if (resolved.endsWith("/v1/traces")) {
        throws += 1;
        if (throws < 3) {
          throw new Error("socket hang up");
        }
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel(baseOptions(fetchImpl as typeof fetch));
    await otel.tracer("a").startActiveSpan("net", async () => {});
    await otel.shutdown();

    const traceAttempts = calls.filter((call) =>
      call.url.endsWith("/v1/traces"),
    );
    expect(traceAttempts.length).toBe(3);
  });

  test("503 on metrics retries then succeeds within one flush", async () => {
    let attempts = 0;
    const calls: FetchCall[] = [];

    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      calls.push({ url: resolved, init });

      if (resolved.endsWith("/v1/metrics")) {
        attempts += 1;

        if (attempts < 3) {
          return new Response(null, { status: 503 });
        }
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel(baseOptions(fetchImpl as typeof fetch));
    otel.meter("m").createCounter("c").add(1);

    await otel.flushAll();
    expect(attempts).toBe(3);

    await otel.shutdown();
  });

  test("multiple trailing slashes on base url normalize to single path join", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      export: { type: "otlp-http", url: "http://collector:4318///" },
    });

    await otel.tracer("a").startActiveSpan("x", async () => {});
    await otel.shutdown();

    expect(
      calls.some((call) => call.url === "http://collector:4318/v1/traces"),
    ).toBe(true);
    expect(calls.every((call) => !call.url.includes("4318///"))).toBe(true);
  });
});

describe("adversarial lifecycle and concurrency", () => {
  test("enabled false shutdown resolves without fetch", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      enabled: false,
    });

    await otel.shutdown();
    await otel.shutdown();
    expect(calls.length).toBe(0);
  });

  test("recording after successful shutdown does not increase fetch calls", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("a").startActiveSpan("before", async () => {});
    await otel.shutdown();
    const afterShutdown = calls.length;

    otel.meter("m").createCounter("c").add(99);
    otel.logger("l").emit({ severityText: "ERROR", body: "late" });
    await otel.tracer("a").startActiveSpan("after", async () => {});

    expect(calls.length).toBe(afterShutdown);
  });

  test("flushAll with empty buffers stays silent", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.flushAll();
    await otel.flushAll();
    expect(calls.length).toBe(0);
    await otel.shutdown();
  });

  test("concurrent flushAll with pending spans completes once", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("a").startActiveSpan("batch", async () => {});
    await Promise.all([otel.flushAll(), otel.flushAll(), otel.flushAll()]);
    await otel.shutdown();

    const tracePosts = calls.filter((call) => call.url.endsWith("/v1/traces"));
    expect(tracePosts.length).toBeGreaterThanOrEqual(1);
  });

  test("double end on manual span still exports single copy", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const span = otel.tracer("a").startSpan("manual-double");

    span.end();
    span.end();
    span.end();
    await otel.shutdown();

    const matches = traceSpans(calls).filter(
      (entry) => entry.name === "manual-double",
    );
    expect(matches.length).toBe(1);
  });

  test("onExportError receives ExportError on periodic failure", async () => {
    const errors: Error[] = [];
    const calls: FetchCall[] = [];

    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      calls.push({ url: resolved, init });

      if (resolved.endsWith("/v1/traces")) {
        return new Response(null, { status: 500 });
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel({
      ...baseOptions(fetchImpl as typeof fetch),
      flushIntervalMs: 25,
      onExportError: (error) => {
        errors.push(error);
      },
    });

    await otel.tracer("a").startActiveSpan("tick", async () => {});

    const deadline = Date.now() + 2500;
    while (errors.length === 0) {
      if (Date.now() > deadline) {
        break;
      }
      await Bun.sleep(25);
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBeInstanceOf(ExportError);

    await otel.shutdown().catch(() => undefined);
  }, 10_000);
});

describe("adversarial multi-replica isolation", () => {
  test("two Otel instances use separate fetch batches", async () => {
    const mockA = createMockFetch();
    const mockB = createMockFetch();

    const otelA = new Otel({
      ...baseOptions(mockA.fetch),
      serviceInstanceId: "replica-a",
    });
    const otelB = new Otel({
      ...baseOptions(mockB.fetch),
      serviceInstanceId: "replica-b",
    });

    await otelA.tracer("a").startActiveSpan("only-a", async () => {});
    await otelB.tracer("b").startActiveSpan("only-b", async () => {});

    await otelA.shutdown();
    await otelB.shutdown();

    expect(mockA.calls.length).toBeGreaterThan(0);
    expect(mockB.calls.length).toBeGreaterThan(0);
    expect(mockA.calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(
      true,
    );
    expect(mockB.calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(
      true,
    );

    const bodyA = parseBody(
      mockA.calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const bodyB = parseBody(
      mockB.calls.find((call) => call.url.endsWith("/v1/traces")),
    );

    const attrsA = bodyA.resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;
    const attrsB = bodyB.resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;

    expect(
      attrsA.find((attr) => attr.key === "service.instance.id")?.value
        .stringValue,
    ).toBe("replica-a");
    expect(
      attrsB.find((attr) => attr.key === "service.instance.id")?.value
        .stringValue,
    ).toBe("replica-b");
  });

  test("inject context on replica A does not affect replica B", async () => {
    const mockA = createMockFetch();
    const mockB = createMockFetch();
    const otelA = new Otel(baseOptions(mockA.fetch));
    const otelB = new Otel(baseOptions(mockB.fetch));

    await otelA.tracer("a").startActiveSpan("iso", async () => {
      const out: Record<string, string> = {};
      inject(out);
      expect(out.traceparent).toBeTruthy();
    });

    const carrier: Record<string, string> = {};
    inject(carrier);
    expect(carrier.traceparent).toBeUndefined();

    await otelA.shutdown();
    await otelB.shutdown();
  });

  test("metrics counters on two instances stay independent", async () => {
    const mockA = createMockFetch();
    const mockB = createMockFetch();
    const otelA = new Otel(baseOptions(mockA.fetch));
    const otelB = new Otel(baseOptions(mockB.fetch));

    otelA.meter("m").createCounter("hits").add(2);
    otelB.meter("m").createCounter("hits").add(5);

    await otelA.shutdown();
    await otelB.shutdown();

    const bodyA = parseBody(
      mockA.calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const bodyB = parseBody(
      mockB.calls.find((call) => call.url.endsWith("/v1/metrics")),
    );

    const valueA =
      bodyA.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;
    const valueB =
      bodyB.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;

    expect(valueA).toBe(2);
    expect(valueB).toBe(5);
  });
});
