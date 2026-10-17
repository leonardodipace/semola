import { describe, expect, test } from "bun:test";
import { InvalidOptionsError } from "./errors.js";
import { Logger } from "./logger.js";
import { Meter } from "./meter.js";
import {
  extract,
  getActiveContext,
  inject,
  runWithContext,
} from "./propagation.js";
import { Tracer } from "./tracer.js";
import type {
  AttributeMap,
  FinishedSpan,
  InstrumentKind,
  LogHost,
  MetricRecorder,
  PendingLogRecord,
  TraceHost,
} from "./types.js";
import {
  SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE,
  SPAN_FLAGS_CONTEXT_IS_REMOTE,
  SPAN_KIND_CODE,
  TRACE_FLAG_SAMPLED,
} from "./types.js";

const createLogHost = () => {
  const records: PendingLogRecord[] = [];
  const host: LogHost = {
    onLogEmitted: (record) => {
      records.push(record);
    },
  };
  return { host, records };
};

const createMeterHost = () => {
  const calls: Array<{
    kind: InstrumentKind;
    name: string;
    value: number;
    attributes: AttributeMap;
    instrumentKey: string;
  }> = [];
  const recorder: MetricRecorder = {
    recordMetric: (
      _scopeName,
      _scopeVersion,
      instrumentKey,
      kind,
      name,
      value,
      attributes,
    ) => {
      calls.push({ kind, name, value, attributes, instrumentKey });
    },
  };
  return { recorder, calls };
};

const createTraceHost = (sampled = true) => {
  const ended: FinishedSpan[] = [];
  const host: TraceHost = {
    shouldRecordTrace: (_traceId, parent) => {
      if (parent) {
        return (parent.traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED;
      }

      return sampled;
    },
    onSpanEnded: (span) => {
      ended.push(span);
    },
  };
  return { host, ended };
};

describe("Logger", () => {
  test("emits severity mapping and guards", () => {
    const { host, records } = createLogHost();
    new Logger(host, { scopeName: "app", scopeVersion: "2" }).emit({
      severityText: "INFO",
      body: "hello",
      attributes: { a: 1 },
      timestamp: 1_700_000_000_000,
    });

    expect(records[0]?.severityNumber).toBe(9);
    expect(records[0]?.scopeVersion).toBe("2");
    expect(records[0]?.timeUnixNano).toBe("1700000000000000000");

    const cases: Array<[string, number | undefined]> = [
      ["TRACE", 1],
      ["WARNING", 13],
      ["FATAL", 21],
      ["NOTICE", undefined],
      ["__proto__", undefined],
    ];

    for (const [severityText, severityNumber] of cases) {
      const probe = createLogHost();
      new Logger(probe.host, { scopeName: "s" }).emit({
        severityText,
        body: "x",
      });
      expect(probe.records[0]?.severityNumber).toBe(severityNumber);
    }
  });
});

describe("Meter", () => {
  test("instruments validate and key by kind", () => {
    const { recorder, calls } = createMeterHost();
    const meter = new Meter(recorder, { scopeName: "m", scopeVersion: "1" });

    meter.createCounter("hits").add(2, { route: "/" });
    meter.createUpDownCounter("depth").add(-3);
    meter.createHistogram("lat").record(4);

    expect(calls.map((call) => call.kind)).toEqual([
      "counter",
      "updowncounter",
      "histogram",
    ]);
    expect(calls[0]?.attributes).toEqual({ route: "/" });

    const keys = new Set(calls.map((call) => call.instrumentKey));
    expect(keys.size).toBe(3);

    const counter = meter.createCounter("c");
    expect(() => counter.add(-1)).toThrow(InvalidOptionsError);
    expect(() => counter.add(Number.NaN)).toThrow(InvalidOptionsError);
    expect(() =>
      meter.createUpDownCounter("u").add(Number.POSITIVE_INFINITY),
    ).toThrow(InvalidOptionsError);
    expect(() => meter.createHistogram("h").record(Number.NaN)).toThrow(
      InvalidOptionsError,
    );
  });
});

describe("Tracer", () => {
  test("active spans nesting kind flags and sampling", async () => {
    const live = createTraceHost();
    const tracer = new Tracer(live.host, { scopeName: "app" });

    await tracer.startActiveSpan("work", async (span) => {
      expect(getActiveContext().span?.spanId).toBe(span.context().spanId);
      span.setAttribute("k", "v");
      span.recordException(new Error("boom"));

      await tracer.startActiveSpan("child", async () => {});
    });

    expect(getActiveContext().span).toBeNull();
    expect(live.ended.find((span) => span.name === "work")?.attributes.k).toBe(
      "v",
    );
    expect(
      live.ended
        .find((span) => span.name === "work")
        ?.events.some((event) => event.name === "exception"),
    ).toBe(true);
    expect(live.ended.find((span) => span.name === "child")?.parentSpanId).toBe(
      live.ended.find((span) => span.name === "work")?.spanId,
    );

    const kindHost = createTraceHost();
    await new Tracer(kindHost.host, { scopeName: "app" }).startActiveSpan(
      "http",
      async () => {},
      { kind: "server" },
    );
    expect(kindHost.ended[0]?.kind).toBe(SPAN_KIND_CODE.server);

    const remoteHost = createTraceHost();
    await new Tracer(remoteHost.host, { scopeName: "app" }).startActiveSpan(
      "child",
      async () => {},
      {
        parent: extract({
          traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
          tracestate: "cong=1",
        }),
      },
    );
    const remoteFlags = remoteHost.ended[0]?.flags ?? 0;
    expect(remoteFlags & SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE).toBe(
      SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE,
    );
    expect(remoteFlags & SPAN_FLAGS_CONTEXT_IS_REMOTE).toBe(
      SPAN_FLAGS_CONTEXT_IS_REMOTE,
    );
    expect(remoteHost.ended[0]?.traceState).toBe("cong=1");

    const dropped = createTraceHost(false);
    const droppedTracer = new Tracer(dropped.host, { scopeName: "app" });
    await droppedTracer.startActiveSpan("x", async (span) => {
      span.setAttribute("n", 1);
    });
    expect(dropped.ended.length).toBe(0);

    const manual = createTraceHost();
    const span = new Tracer(manual.host, { scopeName: "app" }).startSpan("m");
    expect(manual.ended.length).toBe(0);
    span.end();
    span.end();
    expect(manual.ended.length).toBe(1);

    const failing = createTraceHost();
    await expect(
      new Tracer(failing.host, { scopeName: "app" }).startActiveSpan(
        "fail",
        async () => {
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");
    expect(failing.ended.some((entry) => entry.name === "fail")).toBe(true);

    const unsampled = createTraceHost();
    await new Tracer(unsampled.host, { scopeName: "app" }).startActiveSpan(
      "child",
      async () => {},
      {
        parent: extract({
          traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-00`,
        }),
      },
    );
    expect(unsampled.ended.length).toBe(0);
  });
});

describe("propagation", () => {
  test("inject extract ALS and invalid traceparent", () => {
    const carrier: Record<string, string> = {};

    runWithContext(
      {
        span: {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
          traceFlags: 0x101,
          traceState: "vendor=1",
        },
        baggage: "user=42",
      },
      () => {
        inject(carrier);
        expect(getActiveContext().span?.traceId).toBe("a".repeat(32));
      },
    );

    expect(getActiveContext().span).toBeNull();
    expect(carrier.traceparent).toBe(
      `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
    );
    expect(carrier.tracestate).toBe("vendor=1");
    expect(carrier.baggage).toBe("user=42");

    const ctx = extract(carrier);
    expect(ctx.span?.traceId).toBe("a".repeat(32));
    expect(ctx.span?.isRemote).toBe(true);

    const headers = new Headers();
    runWithContext(
      {
        span: {
          traceId: "c".repeat(32),
          spanId: "d".repeat(16),
          traceFlags: 1,
        },
      },
      () => {
        inject(headers);
      },
    );
    expect(extract(headers).span?.traceId).toBe("c".repeat(32));

    const idle: Record<string, string> = { keep: "1" };
    inject(idle);
    expect(idle.traceparent).toBeUndefined();
    expect(idle.keep).toBe("1");
    expect(extract({}).span).toBeNull();
    expect(extract({ baggage: "k=v", traceparent: "bad" }).baggage).toBe("k=v");

    const titled: Record<string, string> = {};
    titled.Traceparent = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
    expect(extract(titled).span?.spanId).toBe("b".repeat(16));

    const invalid = [
      "00-abc",
      `01-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      `00-${"0".repeat(32)}-${"b".repeat(16)}-01`,
      `00-${"a".repeat(32)}-${"0".repeat(16)}-01`,
      `00-${"g".repeat(32)}-${"b".repeat(16)}-01`,
    ];

    for (const traceparent of invalid) {
      expect(extract({ traceparent }).span).toBeNull();
    }
  });
});
