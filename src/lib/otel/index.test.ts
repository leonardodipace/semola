import { describe, expect, test } from "bun:test";
import { ExportError, InvalidOptionsError } from "./errors.js";
import { extract, inject, Otel } from "./index.js";
import {
  baseOptions,
  createFailingPathFetch,
  createMockFetch,
  createTogglePathFetch,
  type FetchCall,
  parseBody,
  pathCallCount,
  resolveUrl,
  signalBody,
  traceSpans,
} from "./test-fixtures.js";
import type { OtelOptions } from "./types.js";
import { HISTOGRAM_EXPLICIT_BOUNDS, TRACE_FLAG_SAMPLED } from "./types.js";

describe("Otel cross-cutting traces", () => {
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
    expect(span?.status).toEqual({ code: 2, message: "charge failed" });
  });

  test("supports fractional start and end times", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan(
      "hr",
      async (span) => {
        span.end(1_700_000_000_000.25);
      },
      { startTime: 1_700_000_000_000.75 },
    );
    await otel.shutdown();

    const hr = traceSpans(calls).find((entry) => entry.name === "hr");
    expect(hr?.startTimeUnixNano.endsWith("750000")).toBe(true);
    expect(hr?.endTimeUnixNano.endsWith("250000")).toBe(true);
  });

  test("groups spans by instrumentation scope", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("a", "1").startActiveSpan("sa", async () => {});
    await otel.tracer("b", "2").startActiveSpan("sb", async () => {});
    await otel.shutdown();

    const scopes = signalBody(calls, "traces").resourceSpans[0]
      .scopeSpans as Array<{ scope: { name: string } }>;
    expect(scopes.length).toBe(2);
    expect(scopes.map((scope) => scope.scope.name).sort()).toEqual(["a", "b"]);
  });
});

describe("Otel sampling", () => {
  test("sampleRatio and remote parent flags", async () => {
    const dropped = createMockFetch();
    const droppedOtel = new Otel({
      ...baseOptions(dropped.fetch),
      sampleRatio: 0,
    });
    await droppedOtel.tracer("app").startActiveSpan("dropped", async () => {});
    await droppedOtel.shutdown();
    expect(pathCallCount(dropped.calls, "/v1/traces")).toBe(0);

    const keep = createMockFetch();
    const keepOtel = new Otel({ ...baseOptions(keep.fetch), sampleRatio: 0 });
    await keepOtel.tracer("app").startActiveSpan("child", async () => {}, {
      parent: extract({
        traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      }),
    });
    await keepOtel.shutdown();
    expect(traceSpans(keep.calls)[0]?.parentSpanId).toBe("b".repeat(16));

    const unsampled = createMockFetch();
    const unsampledOtel = new Otel({
      ...baseOptions(unsampled.fetch),
      sampleRatio: 1,
    });
    await unsampledOtel.tracer("app").startActiveSpan("child", async () => {}, {
      parent: extract({
        traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-00`,
      }),
    });
    await unsampledOtel.tracer("app").startActiveSpan(
      "root",
      async () => {
        await unsampledOtel
          .tracer("app")
          .startActiveSpan("nested", async () => {});
      },
      {
        parent: extract({
          traceparent: `00-${"e".repeat(32)}-${"f".repeat(16)}-00`,
        }),
      },
    );
    await unsampledOtel.shutdown();
    expect(pathCallCount(unsampled.calls, "/v1/traces")).toBe(0);

    const fractional = createMockFetch();
    const fractionalOtel = new Otel({
      ...baseOptions(fractional.fetch),
      sampleRatio: 0.5,
    });
    for (let index = 0; index < 40; index++) {
      await fractionalOtel
        .tracer("app")
        .startActiveSpan(`root-${index}`, async () => {});
    }
    await fractionalOtel.shutdown();
    expect(pathCallCount(fractional.calls, "/v1/traces")).toBe(1);
    expect(traceSpans(fractional.calls).length).toBeGreaterThan(0);
    expect(traceSpans(fractional.calls).length).toBeLessThan(40);
  });
});

const flatMetrics = (calls: FetchCall[], callIndex = -1) => {
  const metricCalls = calls.filter((call) => call.url.endsWith("/v1/metrics"));
  const index = callIndex < 0 ? metricCalls.length + callIndex : callIndex;
  const scopes = parseBody(metricCalls[index]).resourceMetrics[0]
    .scopeMetrics as Array<{
    metrics: Array<{
      name: string;
      sum?: { isMonotonic: boolean; dataPoints: Array<{ asDouble: number }> };
      histogram?: {
        dataPoints: Array<{
          count: string;
          sum: number;
          min: number;
          max: number;
          explicitBounds: number[];
          bucketCounts: string[];
        }>;
      };
    }>;
  }>;

  return scopes.flatMap((scope) => scope.metrics);
};

describe("Otel metrics and logs integration", () => {
  test("exports metric bodies cumulative buckets and attribute series", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));
    const meter = otel.meter("metrics");

    meter.createCounter("orders.paid").add(2, { currency: "USD" });
    meter.createUpDownCounter("queue.depth").add(-1);
    meter
      .createHistogram("charge.duration_ms")
      .record(12, { region: "us-east" });

    const counter = otel.meter("m").createCounter("hits");
    counter.add(1);
    await otel.flushAll();
    counter.add(2);
    await otel.flushAll();

    const hist = otel.meter("m").createHistogram("latency");
    hist.record(3);
    hist.record(40);
    hist.record(2000);

    const byAttr = otel.meter("m").createCounter("by_attr");
    byAttr.add(1, { route: "/a" });
    byAttr.add(2, { route: "/b" });
    await otel.shutdown();

    const first = flatMetrics(calls, 0);
    const second = flatMetrics(calls, 1);
    const last = flatMetrics(calls, -1);

    expect(
      first.find((metric) => metric.name === "orders.paid")?.sum?.isMonotonic,
    ).toBe(true);
    expect(
      first.find((metric) => metric.name === "orders.paid")?.sum?.dataPoints[0]
        ?.asDouble,
    ).toBe(2);
    expect(
      first.find((metric) => metric.name === "queue.depth")?.sum?.isMonotonic,
    ).toBe(false);
    expect(
      first.find((metric) => metric.name === "charge.duration_ms")?.histogram
        ?.dataPoints[0]?.explicitBounds,
    ).toEqual([...HISTOGRAM_EXPLICIT_BOUNDS]);

    expect(
      first.find((metric) => metric.name === "hits")?.sum?.dataPoints[0]
        ?.asDouble,
    ).toBe(1);
    expect(
      second.find((metric) => metric.name === "hits")?.sum?.dataPoints[0]
        ?.asDouble,
    ).toBe(3);

    const latency = last.find((metric) => metric.name === "latency")?.histogram
      ?.dataPoints[0];
    expect(latency?.count).toBe("3");
    expect(latency?.sum).toBe(2043);
    expect(latency?.min).toBe(3);
    expect(latency?.max).toBe(2000);

    expect(
      last.find((metric) => metric.name === "by_attr")?.sum?.dataPoints.length,
    ).toBe(2);
  });

  test("log correlation fractional timestamp and propagation", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    await otel.tracer("app").startActiveSpan("work", async () => {
      otel.logger("app").emit({
        severityText: "INFO",
        body: "hello",
        attributes: { attempt: 1 },
      });
    });
    otel.logger("app").emit({ severityText: "DEBUG", body: "alone" });
    otel.logger("app").emit({
      severityText: "INFO",
      body: "ts",
      timestamp: 1_700_000_000_000.5,
    });

    const parent = extract({
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      tracestate: "cong=1",
      baggage: "userId=42",
    });
    await otel.tracer("app").startActiveSpan(
      "with-state",
      async () => {
        const outbound: Record<string, string> = {};
        inject(outbound);
        expect(outbound.tracestate).toBe("cong=1");
        expect(outbound.baggage).toBe("userId=42");
      },
      { parent },
    );

    await otel.shutdown();

    const records = signalBody(calls, "logs").resourceLogs[0].scopeLogs[0]
      .logRecords as Array<{
      traceId?: string;
      spanId?: string;
      severityText: string;
      body: { stringValue: string };
      timeUnixNano: string;
    }>;

    expect(records[0]?.traceId).toBeDefined();
    expect(records[0]?.spanId).toBeDefined();
    expect(records[0]?.body.stringValue).toBe("hello");
    expect(records[1]?.traceId).toBeUndefined();
    expect(String(records[2]?.timeUnixNano).endsWith("500000")).toBe(true);
    expect(
      traceSpans(calls).find((span) => span.name === "with-state")?.traceState,
    ).toBe("cong=1");
  });
});

describe("Otel export integration", () => {
  test("headers url shaping and independent signal export", async () => {
    const headed = createMockFetch();
    const authHeader = "Authorization";
    const headedOtel = new Otel({
      ...baseOptions(headed.fetch),
      export: {
        type: "otlp-http",
        url: "http://collector:4318",
        headers: { [authHeader]: "Bearer test-token" },
      },
    });
    await headedOtel.tracer("app").startActiveSpan("h", async () => {});
    await headedOtel.shutdown();
    const headers = headed.calls.find((call) => call.url.endsWith("/v1/traces"))
      ?.init?.headers as Record<string, string>;
    expect(headers[authHeader]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const slash = createMockFetch();
    const slashOtel = new Otel({
      ...baseOptions(slash.fetch),
      export: { type: "otlp-http", url: "http://collector:4318/" },
    });
    await slashOtel.tracer("app").startActiveSpan("slash", async () => {});
    await slashOtel.shutdown();
    expect(
      slash.calls.some(
        (call) => call.url === "http://collector:4318/v1/traces",
      ),
    ).toBe(true);

    const prefix = createMockFetch();
    const prefixOtel = new Otel({
      ...baseOptions(prefix.fetch),
      export: { type: "otlp-http", url: "http://collector:4318/otlp" },
    });
    await prefixOtel.tracer("app").startActiveSpan("prefixed", async () => {});
    await prefixOtel.shutdown();
    expect(
      prefix.calls.some(
        (call) => call.url === "http://collector:4318/otlp/v1/traces",
      ),
    ).toBe(true);

    const failing = createFailingPathFetch("/v1/traces");
    const failingOtel = new Otel(baseOptions(failing.fetch));
    await failingOtel.tracer("app").startActiveSpan("both", async () => {
      failingOtel
        .logger("app")
        .emit({ severityText: "ERROR", body: "keep-me" });
    });
    await expect(failingOtel.shutdown()).rejects.toBeInstanceOf(ExportError);
    expect(failing.calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(
      true,
    );
    expect(failing.calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(
      true,
    );
  });

  test("queue drop non-retryable drop and requeues", async () => {
    const queued = createMockFetch();
    const queuedOtel = new Otel({
      ...baseOptions(queued.fetch),
      maxQueueSize: 2,
    });
    await queuedOtel.tracer("app").startActiveSpan("old", async () => {});
    await queuedOtel.tracer("app").startActiveSpan("mid", async () => {});
    await queuedOtel.tracer("app").startActiveSpan("new", async () => {});
    await queuedOtel.shutdown();
    const names = traceSpans(queued.calls).map((span) => span.name);
    expect(names.includes("old")).toBe(false);
    expect(names).toEqual(expect.arrayContaining(["mid", "new"]));

    const calls: FetchCall[] = [];
    const badFetch = async (
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
    const dropOtel = new Otel(baseOptions(badFetch as typeof fetch));
    await dropOtel.tracer("app").startActiveSpan("drop-me", async () => {});
    await expect(dropOtel.shutdown()).rejects.toBeInstanceOf(ExportError);
    await dropOtel.shutdown();
    expect(pathCallCount(calls, "/v1/traces")).toBe(1);

    const traces = createTogglePathFetch("/v1/traces");
    const tracesOtel = new Otel(baseOptions(traces.fetch));
    await tracesOtel.tracer("app").startActiveSpan("retry-me", async () => {});
    await expect(tracesOtel.shutdown()).rejects.toBeInstanceOf(ExportError);
    traces.recover();
    await tracesOtel.shutdown();
    expect(pathCallCount(traces.calls, "/v1/traces")).toBe(4);
    expect(
      traceSpans(traces.calls).some((span) => span.name === "retry-me"),
    ).toBe(true);

    const logs = createTogglePathFetch("/v1/logs");
    const logsOtel = new Otel(baseOptions(logs.fetch));
    logsOtel.logger("app").emit({ severityText: "WARN", body: "keep-log" });
    await expect(logsOtel.flushAll()).rejects.toBeInstanceOf(ExportError);
    logs.recover();
    await logsOtel.flushAll();
    await logsOtel.shutdown();
    expect(pathCallCount(logs.calls, "/v1/logs")).toBe(4);
    expect(
      parseBody(logs.calls.filter((call) => call.url.endsWith("/v1/logs"))[3])
        .resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue,
    ).toBe("keep-log");

    const metrics = createTogglePathFetch("/v1/metrics");
    const metricsOtel = new Otel(baseOptions(metrics.fetch));
    metricsOtel.meter("m").createCounter("hits").add(3);
    await expect(metricsOtel.flushAll()).rejects.toBeInstanceOf(ExportError);
    metrics.recover();
    await metricsOtel.flushAll();
    expect(pathCallCount(metrics.calls, "/v1/metrics")).toBe(4);
    expect(
      parseBody(
        metrics.calls.filter((call) => call.url.endsWith("/v1/metrics"))[3],
      ).resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble,
    ).toBe(3);
    await metricsOtel.shutdown();
  });

  test("flush serialization ExportError and onExportError", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const serialFetch = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(40);
      inFlight -= 1;
      return new Response(null, { status: 200 });
    };
    const serialOtel = new Otel(
      baseOptions(serialFetch as unknown as typeof fetch),
    );
    serialOtel.meter("m").createCounter("hits").add(1);
    await Promise.all([serialOtel.flushAll(), serialOtel.flushAll()]);
    await serialOtel.shutdown();
    expect(maxInFlight).toBe(1);

    const failing = createFailingPathFetch("/v1/metrics");
    const failingOtel = new Otel(baseOptions(failing.fetch));
    failingOtel.meter("m").createCounter("c").add(1);
    await expect(failingOtel.flushAll()).rejects.toBeInstanceOf(ExportError);
    await expect(failingOtel.shutdown()).rejects.toBeInstanceOf(ExportError);

    const errors: Error[] = [];
    const periodic = createFailingPathFetch("/v1/traces");
    const periodicOtel = new Otel({
      ...baseOptions(periodic.fetch),
      flushIntervalMs: 30,
      onExportError: (error) => {
        errors.push(error);
      },
    });
    await periodicOtel.tracer("app").startActiveSpan("x", async () => {});
    const deadline = Date.now() + 2000;
    while (errors.length === 0) {
      if (Date.now() > deadline) {
        break;
      }
      await Bun.sleep(20);
    }
    expect(errors[0]).toBeInstanceOf(ExportError);
    await periodicOtel.shutdown().catch(() => undefined);
  }, 10_000);
});

describe("Otel constructor and lifecycle edges", () => {
  test("rejects invalid options", () => {
    const { fetch } = createMockFetch();
    const invalid: Array<Partial<OtelOptions>> = [
      { serviceName: "  " },
      { export: { type: "otlp-http", url: "" } },
      { sampleRatio: -0.1 },
      { sampleRatio: 1.1 },
      { sampleRatio: Number.NaN },
      { flushIntervalMs: 0 },
      { flushIntervalMs: Number.NaN },
      { flushIntervalMs: Number.POSITIVE_INFINITY },
      { shutdownTimeoutMs: -1 },
      { shutdownTimeoutMs: Number.NaN },
      { maxQueueSize: 0 },
      { maxQueueSize: 1.5 },
    ];

    for (const overrides of invalid) {
      expect(() => {
        new Otel({ ...baseOptions(fetch), ...overrides });
      }).toThrow(InvalidOptionsError);
    }
  });

  test("resource factories enabled false and idempotent shutdown", async () => {
    const res = createMockFetch();
    const resOtel = new Otel({
      ...baseOptions(res.fetch),
      serviceVersion: "9.0.0",
      serviceInstanceId: "node-1",
    });
    await resOtel.tracer("t").startActiveSpan("span", async () => {
      resOtel.meter("m").createCounter("c").add(1);
      resOtel.logger("l").emit({ severityText: "INFO", body: "hi" });
    });
    await resOtel.shutdown();
    const attrs = parseBody(
      res.calls.find((call) => call.url.endsWith("/v1/traces")),
    ).resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;
    expect(
      attrs.find((attr) => attr.key === "service.version")?.value.stringValue,
    ).toBe("9.0.0");
    expect(res.calls.some((call) => call.url.endsWith("/v1/metrics"))).toBe(
      true,
    );
    expect(res.calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(true);

    const disabled = createMockFetch();
    const disabledOtel = new Otel({
      ...baseOptions(disabled.fetch),
      enabled: false,
    });
    await disabledOtel.tracer("t").startActiveSpan("x", async () => {});
    await disabledOtel.shutdown();
    expect(disabled.calls.length).toBe(0);

    const empty = createMockFetch();
    const emptyOtel = new Otel(baseOptions(empty.fetch));
    await emptyOtel.flushAll();
    expect(empty.calls.length).toBe(0);
    await emptyOtel.shutdown();

    const idem = createMockFetch();
    const idemOtel = new Otel(baseOptions(idem.fetch));
    await idemOtel.tracer("t").startActiveSpan("x", async () => {});
    await idemOtel.shutdown();
    const afterFirst = idem.calls.length;
    await idemOtel.shutdown();
    expect(idem.calls.length).toBe(afterFirst);
  });

  test("shutdown during flush timer restart encode drop and abort", async () => {
    let releaseExport: (() => void) | undefined;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const bodies: string[] = [];
    let posts = 0;
    const gatedFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      posts += 1;
      bodies.push(String(init?.body ?? ""));

      if (posts === 1) {
        await exportGate;
      }

      return new Response("{}", { status: 200 });
    };
    const gated = new Otel({
      ...baseOptions(gatedFetch as typeof fetch),
      shutdownTimeoutMs: 5000,
    });
    const tracer = gated.tracer("app");
    tracer.startSpan("before").end();
    const shuttingDown = gated.shutdown();
    await Bun.sleep(10);
    tracer.startSpan("during-shutdown").end();
    releaseExport?.();
    await shuttingDown;
    expect(bodies.some((body) => body.includes("before"))).toBe(true);
    expect(bodies.some((body) => body.includes("during-shutdown"))).toBe(true);

    let failTraces = true;
    const timerCalls: FetchCall[] = [];
    const timerFetch = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const resolved = resolveUrl(url);
      timerCalls.push({ url: resolved, init });

      if (failTraces && resolved.endsWith("/v1/traces")) {
        return new Response(null, { status: 503 });
      }

      return new Response(null, { status: 200 });
    };
    const timed = new Otel({
      ...baseOptions(timerFetch as typeof fetch),
      flushIntervalMs: 30,
    });
    await timed.tracer("t").startActiveSpan("queued", async () => {});
    await expect(timed.shutdown()).rejects.toBeInstanceOf(ExportError);
    const afterFail = timerCalls.length;
    failTraces = false;
    await Bun.sleep(80);
    expect(timerCalls.length).toBeGreaterThan(afterFail);
    await timed.shutdown();

    const poison = createMockFetch();
    const poisonOtel = new Otel(baseOptions(poison.fetch));
    const span = poisonOtel.tracer("app").startSpan("poison");
    span.setAttribute("bad", { nested: true } as unknown as string);
    span.end();
    poisonOtel.logger("app").emit({ severityText: "INFO", body: "still-ok" });
    await expect(poisonOtel.flushAll()).rejects.toBeInstanceOf(ExportError);
    expect(poison.calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(
      false,
    );
    expect(poison.calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(
      true,
    );
    await poisonOtel.tracer("app").startActiveSpan("good", async () => {});
    await poisonOtel.flushAll();
    expect(
      String(
        poison.calls.find((call) => call.url.endsWith("/v1/traces"))?.init
          ?.body,
      ),
    ).toContain("good");
    await poisonOtel.shutdown();

    let sawAbort = false;
    const abortFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const signal = init?.signal;

      if (!signal) {
        return new Response(null, { status: 503 });
      }

      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          sawAbort = true;
          resolve();
          return;
        }

        signal.addEventListener(
          "abort",
          () => {
            sawAbort = true;
            resolve();
          },
          { once: true },
        );
      });

      throw new DOMException("The operation was aborted.", "AbortError");
    };
    const aborting = new Otel({
      ...baseOptions(abortFetch as typeof fetch),
      shutdownTimeoutMs: 50,
    });
    await aborting.tracer("t").startActiveSpan("slow", async () => {});
    await expect(aborting.shutdown()).rejects.toBeInstanceOf(ExportError);
    expect(sawAbort).toBe(true);
  });

  test("flushAll waits for metrics when traces reject", async () => {
    let metricsStarted = false;
    let metricsFinished = false;
    let tracesRejected = false;

    const fetchImpl = async (url: string | URL | Request) => {
      const resolved = resolveUrl(url);

      if (resolved.endsWith("/v1/traces")) {
        await Bun.sleep(30);
        tracesRejected = true;
        return new Response(null, { status: 400 });
      }

      if (resolved.endsWith("/v1/metrics")) {
        metricsStarted = true;
        await Bun.sleep(60);
        metricsFinished = true;
        return new Response(null, { status: 200 });
      }

      return new Response(null, { status: 200 });
    };

    const otel = new Otel(baseOptions(fetchImpl as typeof fetch));
    await otel.tracer("t").startActiveSpan("span", async () => {
      otel.meter("m").createCounter("c").add(1);
    });
    await expect(otel.flushAll()).rejects.toBeInstanceOf(ExportError);
    expect(tracesRejected).toBe(true);
    expect(metricsStarted).toBe(true);
    expect(metricsFinished).toBe(true);
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
