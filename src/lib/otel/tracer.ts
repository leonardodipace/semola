import { getActiveContext, runWithContext } from "./propagation.js";
import type {
  ActiveSpanCallback,
  AttributeMap,
  AttributeValue,
  FinishedSpan,
  OtelContext,
  Scope,
  SpanContext,
  SpanEvent,
  SpanStartOptions,
  SpanState,
  SpanStatus,
  TraceHost,
} from "./types.js";
import {
  SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE,
  SPAN_FLAGS_CONTEXT_IS_REMOTE,
  SPAN_KIND_CODE,
  TRACE_FLAG_SAMPLED,
} from "./types.js";
import {
  randomHex,
  SPAN_ID_BYTES,
  TRACE_ID_BYTES,
  timeUnixNanoString,
} from "./util.js";

const spanFlags = (traceFlags: number, parentIsRemote: boolean) => {
  let flags = traceFlags & 0xff;
  flags |= SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE;

  if (parentIsRemote) {
    flags |= SPAN_FLAGS_CONTEXT_IS_REMOTE;
  }

  return flags;
};

export class Tracer {
  public constructor(
    private host: TraceHost,
    private scope: Scope,
  ) {}

  public startSpan(name: string, options?: SpanStartOptions): Span {
    const parentCtx = options?.parent ?? getActiveContext();
    const parentSpan = parentCtx.span;

    let traceId = randomHex(TRACE_ID_BYTES);
    let parentSpanId: string | undefined;
    let traceState: string | undefined;
    let parentIsRemote = false;

    if (parentSpan) {
      traceId = parentSpan.traceId;
      parentSpanId = parentSpan.spanId;
      traceState = parentSpan.traceState;
      parentIsRemote = parentSpan.isRemote === true;
    }

    const spanId = randomHex(SPAN_ID_BYTES);
    const sampled = this.host.shouldRecordTrace(traceId, parentSpan);

    let traceFlags = 0;

    if (sampled) {
      traceFlags = TRACE_FLAG_SAMPLED;
    }

    const startMs = options?.startTime ?? Date.now();
    const kind = options?.kind ?? "internal";

    return new Span(this.host, {
      name,
      traceId,
      spanId,
      parentSpanId,
      traceFlags,
      traceState,
      parentIsRemote,
      kind,
      dropped: !sampled,
      scope: this.scope,
      startTimeMs: startMs,
      initialAttributes: options?.attributes,
    });
  }

  public async startActiveSpan<T>(
    name: string,
    fn: ActiveSpanCallback<T>,
    options?: SpanStartOptions,
  ): Promise<T> {
    const parentCtx = options?.parent ?? getActiveContext();
    const span = this.startSpan(name, options);
    const ctx: OtelContext = {
      span: span.context(),
      baggage: parentCtx.baggage,
    };

    return runWithContext(ctx, async () => {
      try {
        return await fn(span);
      } finally {
        span.end();
      }
    });
  }
}

export class Span {
  private ended = false;
  private attributes: AttributeMap = {};
  private events: SpanEvent[] = [];
  private status: SpanStatus = { code: "UNSET" };
  private state: SpanState;
  private host: TraceHost;

  public constructor(host: TraceHost, state: SpanState) {
    this.host = host;
    this.state = state;

    if (state.initialAttributes) {
      this.attributes = { ...state.initialAttributes };
    }
  }

  public setAttribute(key: string, value: AttributeValue): void {
    if (this.state.dropped) {
      return;
    }

    this.attributes[key] = value;
  }

  public addEvent(name: string, attributes?: AttributeMap): void {
    if (this.state.dropped) {
      return;
    }

    this.events.push({
      name,
      timeUnixNano: timeUnixNanoString(),
      attributes,
    });
  }

  public recordException(err: Error): void {
    if (this.state.dropped) {
      return;
    }

    this.addEvent("exception", {
      "exception.message": err.message,
      "exception.stack": err.stack ?? "",
      "exception.type": err.name,
    });
  }

  public setStatus(status: SpanStatus): void {
    if (this.state.dropped) {
      return;
    }

    this.status = status;
  }

  public context(): SpanContext {
    const ctx: SpanContext = {
      traceId: this.state.traceId,
      spanId: this.state.spanId,
      traceFlags: this.state.traceFlags,
    };

    if (this.state.traceState) {
      ctx.traceState = this.state.traceState;
    }

    return ctx;
  }

  public end(endTime?: number): void {
    if (this.state.dropped) {
      return;
    }

    if (this.ended) {
      return;
    }

    this.ended = true;

    const endMs = endTime ?? Date.now();
    const finished: FinishedSpan = {
      traceId: this.state.traceId,
      spanId: this.state.spanId,
      parentSpanId: this.state.parentSpanId,
      name: this.state.name,
      kind: SPAN_KIND_CODE[this.state.kind],
      flags: spanFlags(this.state.traceFlags, this.state.parentIsRemote),
      startTimeUnixNano: timeUnixNanoString(this.state.startTimeMs),
      endTimeUnixNano: timeUnixNanoString(endMs),
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      scopeName: this.state.scope.scopeName,
      scopeVersion: this.state.scope.scopeVersion,
    };

    if (this.state.traceState) {
      finished.traceState = this.state.traceState;
    }

    this.host.onSpanEnded(finished);
  }
}
