import { randomBytes } from "node:crypto";
import type { AttributeMap } from "./types.js";
import { HISTOGRAM_EXPLICIT_BOUNDS } from "./types.js";

export const TRACE_ID_BYTES = 16;
export const SPAN_ID_BYTES = 8;

const NANOS_PER_MILLISECOND = 1_000_000;
const SAMPLE_RATIO_BUCKETS = 10_000;

export const randomHex = (byteLength: number) => {
  return randomBytes(byteLength).toString("hex");
};

// Wall-clock unix nanos for OTLP. Bun.nanoseconds / hrtime are monotonic only.
export const timeUnixNanoString = (ms?: number) => {
  const millis = ms ?? Date.now();
  const whole = Math.trunc(millis);
  const fraction = Math.round((millis - whole) * NANOS_PER_MILLISECOND);

  return String(
    BigInt(whole) * BigInt(NANOS_PER_MILLISECOND) + BigInt(fraction),
  );
};

export const sortedAttributeEntries = (attributes: AttributeMap) => {
  const keys = Object.keys(attributes).sort();
  const entries: [string, NonNullable<AttributeMap[string]>][] = [];

  for (const key of keys) {
    const value = attributes[key];

    if (value === undefined) {
      continue;
    }

    entries.push([key, value]);
  }

  return entries;
};

export const attributeKey = (attributes: AttributeMap) => {
  const entries = sortedAttributeEntries(attributes);

  if (entries.length === 0) {
    return "";
  }

  return JSON.stringify(Object.fromEntries(entries));
};

export const rootTraceSampled = (traceId: string, ratio: number) => {
  if (ratio >= 1) {
    return true;
  }

  if (ratio <= 0) {
    return false;
  }

  const slice = traceId.slice(0, 8);
  const n = Number.parseInt(slice, 16);
  const threshold = ratio * SAMPLE_RATIO_BUCKETS;

  return n % SAMPLE_RATIO_BUCKETS < threshold;
};

export const histogramBucketIndex = (value: number) => {
  const index = HISTOGRAM_EXPLICIT_BOUNDS.findIndex((bound) => value <= bound);

  if (index === -1) {
    return HISTOGRAM_EXPLICIT_BOUNDS.length;
  }

  return index;
};
