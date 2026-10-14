import { AsyncLocalStorage } from "node:async_hooks";
import type { OtelContext, TraceCarrier } from "./types.js";

const contextAls = new AsyncLocalStorage<OtelContext>();

const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const TRACE_FLAGS_HEX_WIDTH = 2;
const TRACE_FLAGS_BYTE_MASK = 0xff;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

const formatTraceFlagsHex = (traceFlags: number) =>
  (traceFlags & TRACE_FLAGS_BYTE_MASK)
    .toString(16)
    .padStart(TRACE_FLAGS_HEX_WIDTH, "0");

const getCarrierValue = (carrier: TraceCarrier, name: string) => {
  if (carrier instanceof Headers) {
    return carrier.get(name) ?? undefined;
  }

  const direct = carrier[name];

  if (direct !== undefined) {
    return direct;
  }

  const lower = name.toLowerCase();

  for (const key of Object.keys(carrier)) {
    if (key.toLowerCase() === lower) {
      return carrier[key];
    }
  }

  return undefined;
};

const setCarrierValue = (
  carrier: TraceCarrier,
  name: string,
  value: string,
) => {
  if (carrier instanceof Headers) {
    carrier.set(name, value);
    return;
  }

  carrier[name] = value;
};

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

  const { traceId, spanId, traceFlags, traceState } = ctx.span;
  const traceparent = `00-${traceId}-${spanId}-${formatTraceFlagsHex(traceFlags)}`;

  setCarrierValue(carrier, "traceparent", traceparent);

  if (traceState) {
    setCarrierValue(carrier, "tracestate", traceState);
  }

  if (ctx.baggage) {
    setCarrierValue(carrier, "baggage", ctx.baggage);
  }
};

export const extract = (carrier: TraceCarrier): OtelContext => {
  const raw = getCarrierValue(carrier, "traceparent");
  const baggage = getCarrierValue(carrier, "baggage");
  const withoutSpan: OtelContext = { span: null };

  if (baggage) {
    withoutSpan.baggage = baggage;
  }

  if (!raw) {
    return withoutSpan;
  }

  const match = TRACEPARENT.exec(raw.trim());

  if (!match) {
    return withoutSpan;
  }

  const [, traceIdRaw = "", spanIdRaw = "", flagsHex = ""] = match;
  const traceId = traceIdRaw.toLowerCase();
  const spanId = spanIdRaw.toLowerCase();

  if (traceId === ZERO_TRACE_ID) {
    return withoutSpan;
  }

  if (spanId === ZERO_SPAN_ID) {
    return withoutSpan;
  }

  const traceState = getCarrierValue(carrier, "tracestate");
  const span = {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flagsHex, 16),
    isRemote: true,
  };

  if (traceState) {
    return {
      span: { ...span, traceState },
      baggage,
    };
  }

  return {
    span,
    baggage,
  };
};
