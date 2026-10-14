import { describe, expect, test } from "bun:test";
import { extract, getActiveContext } from "./propagation.js";
import { Tracer } from "./tracer.js";
import type { FinishedSpan, SpanContext, TraceHost } from "./types.js";
import {
  SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE,
  SPAN_FLAGS_CONTEXT_IS_REMOTE,
  SPAN_KIND_CODE,
  TRACE_FLAG_SAMPLED,
} from "./types.js";

const createHost = (sampled = true) => {
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

describe("Tracer", () => {
  test("startActiveSpan exports span and restores context", async () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });

    await tracer.startActiveSpan("work", async (span) => {
      expect(getActiveContext().span?.spanId).toBe(span.context().spanId);
      span.setAttribute("k", "v");
    });

    expect(getActiveContext().span).toBeNull();
    expect(ended.length).toBe(1);
    expect(ended[0]?.name).toBe("work");
    expect(ended[0]?.attributes.k).toBe("v");
    expect(ended[0]?.kind).toBe(SPAN_KIND_CODE.internal);
  });

  test("nested spans share trace id and set parent", async () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });

    await tracer.startActiveSpan("root", async (root) => {
      await tracer.startActiveSpan("child", async (child) => {
        expect(child.context().traceId).toBe(root.context().traceId);
      });
    });

    const child = ended.find((span) => span.name === "child");
    const root = ended.find((span) => span.name === "root");
    expect(child?.parentSpanId).toBe(root?.spanId);
  });

  test("exports requested span kind", async () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });

    await tracer.startActiveSpan("http", async () => {}, { kind: "server" });

    expect(ended[0]?.kind).toBe(SPAN_KIND_CODE.server);
  });

  test("remote parent sets is-remote flags and inherits tracestate", async () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });
    const parent = extract({
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      tracestate: "cong=1",
    });

    await tracer.startActiveSpan("child", async () => {}, { parent });

    const flags = ended[0]?.flags ?? 0;
    expect(ended[0]?.traceId).toBe("a".repeat(32));
    expect(ended[0]?.parentSpanId).toBe("b".repeat(16));
    expect(ended[0]?.traceState).toBe("cong=1");
    expect(flags & SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE).toBe(
      SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE,
    );
    expect(flags & SPAN_FLAGS_CONTEXT_IS_REMOTE).toBe(
      SPAN_FLAGS_CONTEXT_IS_REMOTE,
    );
  });

  test("unsampled spans are dropped", async () => {
    const { host, ended } = createHost(false);
    const tracer = new Tracer(host, { scopeName: "app" });

    await tracer.startActiveSpan("dropped", async (span) => {
      span.setAttribute("x", 1);
      span.addEvent("e");
      span.setStatus({ code: "ERROR", message: "nope" });
    });

    expect(ended.length).toBe(0);
  });

  test("manual startSpan requires end to export", () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });
    const span = tracer.startSpan("manual");

    expect(ended.length).toBe(0);
    span.end();
    expect(ended.length).toBe(1);
  });

  test("double end exports once", () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });
    const span = tracer.startSpan("once");
    span.end();
    span.end();
    expect(ended.length).toBe(1);
  });

  test("recordException adds exception event", async () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });

    await tracer.startActiveSpan("risky", async (span) => {
      span.recordException(new Error("boom"));
      span.setStatus({ code: "ERROR", message: "boom" });
    });

    expect(ended[0]?.events[0]?.name).toBe("exception");
    expect(ended[0]?.status.code).toBe("ERROR");
  });

  test("startActiveSpan rethrows callback errors after ending", async () => {
    const { host, ended } = createHost();
    const tracer = new Tracer(host, { scopeName: "app" });

    await expect(
      tracer.startActiveSpan("fail", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    expect(ended.length).toBe(1);
  });

  test("follows remote unsampled parent", async () => {
    const { host, ended } = createHost(true);
    const tracer = new Tracer(host, { scopeName: "app" });
    const parent: { span: SpanContext } = {
      span: {
        traceId: "c".repeat(32),
        spanId: "d".repeat(16),
        traceFlags: 0,
        isRemote: true,
      },
    };

    await tracer.startActiveSpan("child", async () => {}, { parent });
    expect(ended.length).toBe(0);
  });
});
