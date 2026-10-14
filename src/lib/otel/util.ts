import type { AttributeMap } from "./types.js";
import { HISTOGRAM_EXPLICIT_BOUNDS } from "./types.js";

export const TRACE_ID_BYTES = 16;
export const SPAN_ID_BYTES = 8;

const NANOS_PER_MILLISECOND = 1_000_000;
const SAMPLE_RATIO_BUCKETS = 10_000;

export const randomHex = (byteLength: number) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let hex = "";

  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return hex;
};

export const timeUnixNanoString = (ms?: number) => {
  const millis = ms ?? Date.now();
  const whole = Math.trunc(millis);
  const fraction = Math.round((millis - whole) * NANOS_PER_MILLISECOND);

  return String(
    BigInt(whole) * BigInt(NANOS_PER_MILLISECOND) + BigInt(fraction),
  );
};

export const attributeKey = (attributes: AttributeMap) => {
  const keys = Object.keys(attributes).sort();

  if (keys.length === 0) {
    return "";
  }

  const sorted: AttributeMap = {};

  for (const key of keys) {
    const value = attributes[key];

    if (value === undefined) {
      continue;
    }

    sorted[key] = value;
  }

  return JSON.stringify(sorted);
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
  for (let i = 0; i < HISTOGRAM_EXPLICIT_BOUNDS.length; i++) {
    const bound = HISTOGRAM_EXPLICIT_BOUNDS[i];

    if (bound !== undefined && value <= bound) {
      return i;
    }
  }

  return HISTOGRAM_EXPLICIT_BOUNDS.length;
};
