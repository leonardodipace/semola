import { AsyncLocalStorage } from "node:async_hooks";
import type { OtelContext, TraceCarrier } from "./types.js";

const contextAls = new AsyncLocalStorage<OtelContext>();

const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
/** W3C trace-flags field is always two lowercase hex digits. */
const TRACE_FLAGS_HEX_WIDTH = 2;

// W3C traceparent: version 00, 32-hex trace id, 16-hex span id, 2-hex flags
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

const formatTraceFlagsHex = (traceFlags: number) =>
  traceFlags.toString(16).padStart(TRACE_FLAGS_HEX_WIDTH, "0");

export const runWithContext = <T>(ctx: OtelContext, fn: () => T): T => {
  return contextAls.run(ctx, fn);
};

export const getActiveContext = (): OtelContext => {
  return contextAls.getStore() ?? { span: null };
};

export const inject = (carrier: TraceCarrier) => {
  const ctx = contextAls.getStore();

  if (!ctx?.span) {
    return;
  }

  const { traceId, spanId, traceFlags } = ctx.span;
  const traceparent = `00-${traceId}-${spanId}-${formatTraceFlagsHex(traceFlags)}`;

  if (carrier instanceof Headers) {
    carrier.set("traceparent", traceparent);
    return;
  }

  carrier.traceparent = traceparent;
};

export const extract = (carrier: TraceCarrier): OtelContext => {
  let raw: string | null | undefined;

  if (carrier instanceof Headers) {
    raw = carrier.get("traceparent");
  } else {
    raw = carrier.traceparent;
  }

  if (!raw) {
    return { span: null };
  }

  const match = TRACEPARENT.exec(raw.trim());

  if (!match) {
    return { span: null };
  }

  const [, traceIdRaw, spanIdRaw, flagsHex] = match;

  if (!traceIdRaw) {
    return { span: null };
  }

  if (!spanIdRaw) {
    return { span: null };
  }

  if (!flagsHex) {
    return { span: null };
  }

  const traceId = traceIdRaw.toLowerCase();
  const spanId = spanIdRaw.toLowerCase();

  if (traceId === ZERO_TRACE_ID) {
    return { span: null };
  }

  if (spanId === ZERO_SPAN_ID) {
    return { span: null };
  }

  return {
    span: {
      traceId,
      spanId,
      traceFlags: Number.parseInt(flagsHex, 16),
    },
  };
};
