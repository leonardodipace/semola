import { describe, expect, test } from "bun:test";
import {
  extract,
  getActiveContext,
  inject,
  runWithContext,
} from "./propagation.js";

describe("inject and extract", () => {
  test("roundtrips traceparent on a plain record", () => {
    const carrier: Record<string, string> = {};

    runWithContext(
      {
        span: {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
          traceFlags: 1,
        },
      },
      () => {
        inject(carrier);
      },
    );

    expect(carrier.traceparent).toBe(
      `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
    );

    const ctx = extract(carrier);
    expect(ctx.span?.traceId).toBe("a".repeat(32));
    expect(ctx.span?.spanId).toBe("b".repeat(16));
    expect(ctx.span?.traceFlags).toBe(1);
    expect(ctx.span?.isRemote).toBe(true);
  });

  test("injects tracestate and baggage when present", () => {
    const carrier: Record<string, string> = {};

    runWithContext(
      {
        span: {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
          traceFlags: 1,
          traceState: "vendor=1",
        },
        baggage: "user=42",
      },
      () => {
        inject(carrier);
      },
    );

    expect(carrier.tracestate).toBe("vendor=1");
    expect(carrier.baggage).toBe("user=42");
  });

  test("extract keeps baggage when traceparent is invalid", () => {
    const ctx = extract({
      traceparent: "bad",
      baggage: "k=v",
    });

    expect(ctx.span).toBeNull();
    expect(ctx.baggage).toBe("k=v");
  });

  test("extract rejects all-zero ids", () => {
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

  test("masks oversized traceFlags to two hex digits", () => {
    const carrier: Record<string, string> = {};

    runWithContext(
      {
        span: {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
          traceFlags: 0x101,
        },
      },
      () => {
        inject(carrier);
      },
    );

    expect(carrier.traceparent?.endsWith("-01")).toBe(true);
  });

  test("works with Headers", () => {
    const headers = new Headers();

    runWithContext(
      {
        span: {
          traceId: "c".repeat(32),
          spanId: "d".repeat(16),
          traceFlags: 1,
          traceState: "ts=1",
        },
        baggage: "b=1",
      },
      () => {
        inject(headers);
      },
    );

    expect(headers.get("traceparent")).toContain("c".repeat(32));
    expect(headers.get("tracestate")).toBe("ts=1");
    expect(headers.get("baggage")).toBe("b=1");

    const ctx = extract(headers);
    expect(ctx.span?.traceId).toBe("c".repeat(32));
    expect(ctx.baggage).toBe("b=1");
  });

  test("inject is a no-op without active span", () => {
    const carrier: Record<string, string> = { keep: "1" };
    inject(carrier);
    expect(carrier.traceparent).toBeUndefined();
    expect(carrier.keep).toBe("1");
  });
});

describe("runWithContext and getActiveContext", () => {
  test("getActiveContext is empty outside runWithContext", () => {
    expect(getActiveContext().span).toBeNull();
  });

  test("runWithContext restores prior store after return", () => {
    runWithContext(
      {
        span: {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
          traceFlags: 1,
        },
      },
      () => {
        expect(getActiveContext().span?.traceId).toBe("a".repeat(32));
      },
    );

    expect(getActiveContext().span).toBeNull();
  });
});
