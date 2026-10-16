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

  test("rejects non-finite or fractional maxQueueSize", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({ ...baseOptions(fetch), maxQueueSize: Number.NaN });
    }).toThrow(InvalidOptionsError);

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        maxQueueSize: Number.POSITIVE_INFINITY,
      });
    }).toThrow(InvalidOptionsError);

    expect(() => {
      new Otel({ ...baseOptions(fetch), maxQueueSize: 1.5 });
    }).toThrow(InvalidOptionsError);

    expect(() => {
      new Otel({ ...baseOptions(fetch), maxQueueSize: 0 });
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

  test("shutdown exports spans that end during the final flush", async () => {
    let releaseExport: (() => void) | undefined;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const bodies: string[] = [];
    let posts = 0;

    const fetchImpl = async (
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

    const otel = new Otel({
      ...baseOptions(fetchImpl as typeof fetch),
      shutdownTimeoutMs: 5000,
    });
    const tracer = otel.tracer("app");

    tracer.startSpan("before").end();

    const shutdownPromise = otel.shutdown();

    await Bun.sleep(10);
    tracer.startSpan("during-shutdown").end();
    releaseExport?.();

    await shutdownPromise;

    expect(bodies.some((body) => body.includes("before"))).toBe(true);
    expect(bodies.some((body) => body.includes("during-shutdown"))).toBe(true);
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
        return new Response(null, { status: 503 });
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

  test("rejects negative shutdownTimeoutMs", () => {
    const { fetch } = createMockFetch();

    expect(() => {
      new Otel({
        ...baseOptions(fetch),
        shutdownTimeoutMs: -1,
      });
    }).toThrow(InvalidOptionsError);
  });

  test("encode failure drops the bad batch and still exports logs", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel(baseOptions(fetch));

    const span = otel.tracer("app").startSpan("poison");
    span.setAttribute("bad", { nested: true } as unknown as string);
    span.end();
    otel.logger("app").emit({ severityText: "INFO", body: "still-ok" });

    await expect(otel.flushAll()).rejects.toBeInstanceOf(ExportError);

    expect(calls.some((call) => call.url.endsWith("/v1/traces"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/v1/logs"))).toBe(true);

    await otel.tracer("app").startActiveSpan("good", async () => {});
    await otel.flushAll();

    const traceCalls = calls.filter((call) => call.url.endsWith("/v1/traces"));
    expect(traceCalls.length).toBe(1);
    expect(String(traceCalls[0]?.init?.body)).toContain("good");
    expect(String(traceCalls[0]?.init?.body)).not.toContain("poison");

    await otel.shutdown();
  });

  test("shutdown cancels in-flight export within budget", async () => {
    let sawAbort = false;

    const fetchImpl = async (
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

    const otel = new Otel({
      ...baseOptions(fetchImpl as typeof fetch),
      shutdownTimeoutMs: 50,
    });

    await otel.tracer("t").startActiveSpan("slow", async () => {});

    await expect(otel.shutdown()).rejects.toBeInstanceOf(ExportError);
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
