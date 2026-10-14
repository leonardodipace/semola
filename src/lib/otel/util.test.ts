import { describe, expect, test } from "bun:test";
import { HISTOGRAM_EXPLICIT_BOUNDS } from "./types.js";
import {
  attributeKey,
  histogramBucketIndex,
  randomHex,
  rootTraceSampled,
  SPAN_ID_BYTES,
  TRACE_ID_BYTES,
  timeUnixNanoString,
} from "./util.js";

describe("randomHex", () => {
  test("returns lowercase hex of requested byte length", () => {
    const hex = randomHex(TRACE_ID_BYTES);
    expect(hex).toHaveLength(TRACE_ID_BYTES * 2);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  test("span id width matches SPAN_ID_BYTES", () => {
    expect(randomHex(SPAN_ID_BYTES)).toHaveLength(SPAN_ID_BYTES * 2);
  });
});

describe("timeUnixNanoString", () => {
  test("defaults to current time as digit string", () => {
    const value = timeUnixNanoString();
    expect(value).toMatch(/^\d+$/);
    expect(BigInt(value) > 0n).toBe(true);
  });

  test("converts whole milliseconds to nanos", () => {
    expect(timeUnixNanoString(1_700_000_000_000)).toBe("1700000000000000000");
  });

  test("preserves fractional milliseconds", () => {
    expect(timeUnixNanoString(1_700_000_000_000.5)).toBe("1700000000000500000");
  });
});

describe("attributeKey", () => {
  test("empty attributes yield empty key", () => {
    expect(attributeKey({})).toBe("");
  });

  test("sorts keys for stable series identity", () => {
    expect(attributeKey({ b: "2", a: "1" })).toBe(
      attributeKey({ a: "1", b: "2" }),
    );
  });
});

describe("rootTraceSampled", () => {
  const traceId = "abcdef0123456789abcdef0123456789";

  test("ratio 1 always samples", () => {
    expect(rootTraceSampled(traceId, 1)).toBe(true);
  });

  test("ratio 0 never samples", () => {
    expect(rootTraceSampled(traceId, 0)).toBe(false);
  });

  test("same trace id is deterministic for a ratio", () => {
    const first = rootTraceSampled(traceId, 0.5);
    const second = rootTraceSampled(traceId, 0.5);
    expect(first).toBe(second);
  });
});

describe("histogramBucketIndex", () => {
  test("values at or below first bound use index 0", () => {
    expect(histogramBucketIndex(0)).toBe(0);
  });

  test("values above last bound use overflow bucket", () => {
    const last =
      HISTOGRAM_EXPLICIT_BOUNDS[HISTOGRAM_EXPLICIT_BOUNDS.length - 1];
    expect(last).toBeDefined();
    expect(histogramBucketIndex((last as number) + 1)).toBe(
      HISTOGRAM_EXPLICIT_BOUNDS.length,
    );
  });
});
