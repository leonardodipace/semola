import { AsyncLocalStorage } from "node:async_hooks";
import { mightThrow } from "../errors/index.js";
import { ExportError, InvalidOptionsError } from "./errors.js";
import {
  encodeLogsExport,
  encodeMetricsExport,
  encodeTracesExport,
  otlpPost,
} from "./otlp.js";
import type {
  ActiveSpanCallback,
  AttributeMap,
  AttributeValue,
  FinishedSpan,
  HistogramMetricBucket,
  InstrumentHandle,
  InstrumentKey,
  InstrumentKind,
  LogRecord,
  MetricOptions,
  MetricPoint,
  OtelContext,
  OtelOptions,
  PendingLogRecord,
  RegisteredInstrument,
  Resource,
  Scope,
  ScopeLogs,
  ScopeMetrics,
  ScopeSpans,
  SpanContext,
  SpanEvent,
  SpanStartOptions,
  SpanState,
  SpanStatus,
  SumMetricBucket,
} from "./types.js";
import {
  DEFAULT_FLUSH_INTERVAL_MS,
  HISTOGRAM_EXPLICIT_BOUNDS,
  TRACE_FLAG_SAMPLED,
} from "./types.js";

const contextAls = new AsyncLocalStorage<OtelContext>();

const SPAN_KIND_INTERNAL = 1;
const TRACEPARENT_VERSION = "00";
const TRACE_ID_LENGTH = 32;
const SPAN_ID_LENGTH = 16;
const FLAGS_HEX_LENGTH = 2;

const isLowerHexChar = (char: string) => {
  const code = char.charCodeAt(0);

  if (code >= 48 && code <= 57) {
    return true;
  }

  if (code >= 97 && code <= 102) {
    return true;
  }

  return false;
};

const isLowerHex = (value: string) => {
  for (const char of value) {
    if (!isLowerHexChar(char)) {
      return false;
    }
  }

  return true;
};

const isAllZeros = (value: string) => {
  for (const char of value) {
    if (char !== "0") {
      return false;
    }
  }

  return true;
};

const readTraceparent = (carrier: Headers | Record<string, string>) => {
  if (carrier instanceof Headers) {
    return carrier.get("traceparent");
  }

  return carrier.traceparent;
};

export const inject = (carrier: Headers | Record<string, string>) => {
  const ctx = contextAls.getStore();

  if (!ctx?.span) {
    return;
  }

  const { traceId, spanId, traceFlags } = ctx.span;
  const flags = traceFlags.toString(16).padStart(2, "0");
  const traceparent = `${TRACEPARENT_VERSION}-${traceId}-${spanId}-${flags}`;

  if (carrier instanceof Headers) {
    carrier.set("traceparent", traceparent);
    return;
  }

  carrier.traceparent = traceparent;
};

export const extract = (
  carrier: Headers | Record<string, string>,
): OtelContext => {
  const raw = readTraceparent(carrier);

  if (!raw) {
    return { span: null };
  }

  const parts = raw.trim().split("-");

  if (parts.length !== 4) {
    return { span: null };
  }

  const [version, traceIdRaw, spanIdRaw, flagsHex] = parts;

  if (version !== TRACEPARENT_VERSION) {
    return { span: null };
  }

  if (!traceIdRaw) {
    return { span: null };
  }

  if (!spanIdRaw) {
    return { span: null };
  }

  if (!flagsHex) {
    return { span: null };
  }

  if (traceIdRaw.length !== TRACE_ID_LENGTH) {
    return { span: null };
  }

  if (spanIdRaw.length !== SPAN_ID_LENGTH) {
    return { span: null };
  }

  if (flagsHex.length !== FLAGS_HEX_LENGTH) {
    return { span: null };
  }

  const traceId = traceIdRaw.toLowerCase();
  const spanId = spanIdRaw.toLowerCase();
  const flags = flagsHex.toLowerCase();

  if (!isLowerHex(traceId)) {
    return { span: null };
  }

  if (isAllZeros(traceId)) {
    return { span: null };
  }

  if (!isLowerHex(spanId)) {
    return { span: null };
  }

  if (isAllZeros(spanId)) {
    return { span: null };
  }

  if (!isLowerHex(flags)) {
    return { span: null };
  }

  const traceFlags = Number.parseInt(flags, 16);

  return {
    span: {
      traceId,
      spanId,
      traceFlags,
      isRemote: true,
    },
  };
};

const randomHex = (byteLength: number) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let hex = "";

  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return hex;
};

const timeUnixNanoString = (ms?: number) => {
  const millis = ms ?? Date.now();
  const whole = Math.trunc(millis);
  const fraction = Math.round((millis - whole) * 1_000_000);

  return String(BigInt(whole) * 1_000_000n + BigInt(fraction));
};

const attributeKey = (attributes: AttributeMap) => {
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

const rootTraceSampled = (traceId: string, ratio: number) => {
  if (ratio >= 1) {
    return true;
  }

  if (ratio <= 0) {
    return false;
  }

  const slice = traceId.slice(0, 8);
  const n = Number.parseInt(slice, 16);
  const threshold = ratio * 10_000;

  return n % 10_000 < threshold;
};

const histogramBucketIndex = (value: number) => {
  for (let i = 0; i < HISTOGRAM_EXPLICIT_BOUNDS.length; i++) {
    const bound = HISTOGRAM_EXPLICIT_BOUNDS[i];

    if (bound !== undefined && value <= bound) {
      return i;
    }
  }

  return HISTOGRAM_EXPLICIT_BOUNDS.length;
};

export class Otel {
  private enabled: boolean;
  private shutDown = false;
  private sampleRatio: number;
  private resource: Resource;
  private exportOptions: OtelOptions["export"];
  private fetchImpl: typeof fetch;
  private spanBatch: FinishedSpan[] = [];
  private logBatch: PendingLogRecord[] = [];
  private metricRegistry = new Map<InstrumentKey, RegisteredInstrument>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushIntervalMs: number;
  private onExportError: ((error: Error) => void) | undefined;

  public constructor(options: OtelOptions) {
    if (!options.serviceName.trim()) {
      throw new InvalidOptionsError("serviceName is required");
    }

    if (options.export.type !== "otlp-http") {
      throw new InvalidOptionsError("export.type must be otlp-http");
    }

    if (!options.export.url.trim()) {
      throw new InvalidOptionsError("export.url is required");
    }

    const ratio = options.sampleRatio ?? 1;

    if (ratio < 0 || ratio > 1) {
      throw new InvalidOptionsError("sampleRatio must be between 0 and 1");
    }

    this.sampleRatio = ratio;
    this.exportOptions = options.export;
    this.fetchImpl = options.fetch ?? fetch;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.onExportError = options.onExportError;

    const attributes: AttributeMap = {
      "service.name": options.serviceName,
    };

    if (options.serviceVersion) {
      attributes["service.version"] = options.serviceVersion;
    }

    this.resource = { attributes };

    const enabled = options.enabled !== false;
    this.enabled = enabled;

    if (!this.enabled) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flushAll().catch((error: unknown) => {
        if (error instanceof Error) {
          this.onExportError?.(error);
          return;
        }

        this.onExportError?.(new ExportError(String(error)));
      });
    }, this.flushIntervalMs);
    this.flushTimer.unref();
  }

  public tracer(scopeName: string, scopeVersion?: string): Tracer {
    return new Tracer(this, { scopeName, scopeVersion });
  }

  public meter(scopeName: string, scopeVersion?: string): Meter {
    return new Meter(this, { scopeName, scopeVersion });
  }

  public logger(scopeName: string, scopeVersion?: string): Logger {
    return new Logger(this, { scopeName, scopeVersion });
  }

  public async shutdown(): Promise<void> {
    if (this.shutDown) {
      return;
    }

    this.shutDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (!this.enabled) {
      return;
    }

    await this.flushAll();
  }

  public runWithContext<T>(ctx: OtelContext, fn: () => T): T {
    return contextAls.run(ctx, fn);
  }

  public getActiveContext(): OtelContext {
    return contextAls.getStore() ?? { span: null };
  }

  public shouldRecordTrace(
    traceId: string,
    parent: SpanContext | null,
  ): boolean {
    if (parent) {
      return (parent.traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED;
    }

    if (this.sampleRatio >= 1) {
      return true;
    }

    if (this.sampleRatio <= 0) {
      return false;
    }

    return rootTraceSampled(traceId, this.sampleRatio);
  }

  public onSpanEnded(span: FinishedSpan): void {
    if (!this.canRecord()) {
      return;
    }

    this.spanBatch.push(span);
  }

  public onLogEmitted(record: PendingLogRecord): void {
    if (!this.canRecord()) {
      return;
    }

    const active = this.getActiveContext().span;

    if (active) {
      record.traceId = active.traceId;
      record.spanId = active.spanId;
    }

    this.logBatch.push(record);
  }

  public recordMetric(
    scopeName: string,
    scopeVersion: string | undefined,
    instrumentKey: InstrumentKey,
    kind: InstrumentKind,
    name: string,
    value: number,
    attributes: AttributeMap,
    options: MetricOptions,
  ): void {
    if (!this.canRecord()) {
      return;
    }

    let instrument = this.metricRegistry.get(instrumentKey);

    if (!instrument) {
      instrument = {
        kind,
        name,
        scopeName,
        scopeVersion,
        unit: options.unit,
        description: options.description,
        sums: new Map(),
        histograms: new Map(),
      };
      this.metricRegistry.set(instrumentKey, instrument);
    }

    const now = timeUnixNanoString();
    const key = attributeKey(attributes);

    if (kind === "histogram") {
      this.addHistogram(instrument, key, attributes, value, now);
      return;
    }

    this.addSum(instrument, key, attributes, value, now);
  }

  public async flushAll(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await Promise.all([this.flushTracesAndLogs(), this.flushMetrics()]);
  }

  private canRecord(): boolean {
    if (!this.enabled) {
      return false;
    }

    if (this.shutDown) {
      return false;
    }

    return true;
  }

  private addSum(
    instrument: RegisteredInstrument,
    key: string,
    attributes: AttributeMap,
    value: number,
    now: string,
  ): void {
    let bucket = instrument.sums.get(key);

    if (!bucket) {
      bucket = {
        attributes,
        value: 0,
        startTimeUnixNano: now,
      };
      instrument.sums.set(key, bucket);
    }

    bucket.value += value;
  }

  private addHistogram(
    instrument: RegisteredInstrument,
    key: string,
    attributes: AttributeMap,
    value: number,
    now: string,
  ): void {
    let bucket = instrument.histograms.get(key);

    if (!bucket) {
      const bucketCounts = new Array<number>(
        HISTOGRAM_EXPLICIT_BOUNDS.length + 1,
      ).fill(0);

      bucket = {
        attributes,
        count: 0,
        sum: 0,
        min: value,
        max: value,
        bucketCounts,
        startTimeUnixNano: now,
      };
      instrument.histograms.set(key, bucket);
    }

    bucket.count += 1;
    bucket.sum += value;

    if (value < bucket.min) {
      bucket.min = value;
    }

    if (value > bucket.max) {
      bucket.max = value;
    }

    const index = histogramBucketIndex(value);
    const current = bucket.bucketCounts[index];

    if (current !== undefined) {
      bucket.bucketCounts[index] = current + 1;
    }
  }

  private async flushTracesAndLogs(): Promise<void> {
    const spans = this.spanBatch;
    const logs = this.logBatch;
    this.spanBatch = [];
    this.logBatch = [];

    if (spans.length === 0 && logs.length === 0) {
      return;
    }

    const headers = this.exportOptions.headers;
    let exportError: ExportError | null = null;

    if (spans.length > 0) {
      const scopeSpans = groupSpansByScope(spans);
      const body = encodeTracesExport(this.resource, scopeSpans);

      const [error] = await mightThrow(
        otlpPost({
          baseUrl: this.exportOptions.url,
          path: "/v1/traces",
          body,
          fetch: this.fetchImpl,
          headers,
        }),
      );

      if (error) {
        exportError = new ExportError(error.message);
      }
    }

    if (logs.length > 0) {
      const scopeLogs = groupLogsByScope(logs);
      const body = encodeLogsExport(this.resource, scopeLogs);

      const [error] = await mightThrow(
        otlpPost({
          baseUrl: this.exportOptions.url,
          path: "/v1/logs",
          body,
          fetch: this.fetchImpl,
          headers,
        }),
      );

      if (error) {
        if (!exportError) {
          exportError = new ExportError(error.message);
        }
      }
    }

    if (exportError) {
      throw exportError;
    }
  }

  private async flushMetrics(): Promise<void> {
    const points: MetricPoint[] = [];
    const now = timeUnixNanoString();

    for (const instrument of this.metricRegistry.values()) {
      const dataPoints = snapshotInstrument(instrument, now);

      if (dataPoints.length === 0) {
        continue;
      }

      points.push({
        name: instrument.name,
        kind: instrument.kind,
        unit: instrument.unit,
        description: instrument.description,
        scopeName: instrument.scopeName,
        scopeVersion: instrument.scopeVersion,
        dataPoints,
      });
    }

    if (points.length === 0) {
      return;
    }

    const scopeMetrics = groupMetricsByScope(points);
    const body = encodeMetricsExport(this.resource, scopeMetrics);

    const [error] = await mightThrow(
      otlpPost({
        baseUrl: this.exportOptions.url,
        path: "/v1/metrics",
        body,
        fetch: this.fetchImpl,
        headers: this.exportOptions.headers,
      }),
    );

    if (error) {
      throw new ExportError(error.message);
    }
  }
}

const groupSpansByScope = (spans: FinishedSpan[]): ScopeSpans[] => {
  const map = new Map<string, ScopeSpans>();

  for (const span of spans) {
    const scopeKey = `${span.scopeName}\0${span.scopeVersion ?? ""}`;
    let group = map.get(scopeKey);

    if (!group) {
      group = {
        scope: {
          scopeName: span.scopeName,
          scopeVersion: span.scopeVersion,
        },
        spans: [],
      };
      map.set(scopeKey, group);
    }

    group.spans.push(span);
  }

  return [...map.values()];
};

const groupLogsByScope = (logs: PendingLogRecord[]): ScopeLogs[] => {
  const map = new Map<string, ScopeLogs>();

  for (const record of logs) {
    const scopeKey = `${record.scopeName}\0${record.scopeVersion ?? ""}`;
    let group = map.get(scopeKey);

    if (!group) {
      group = {
        scope: {
          scopeName: record.scopeName,
          scopeVersion: record.scopeVersion,
        },
        logRecords: [],
      };
      map.set(scopeKey, group);
    }

    group.logRecords.push(record);
  }

  return [...map.values()];
};

const groupMetricsByScope = (metrics: MetricPoint[]): ScopeMetrics[] => {
  const map = new Map<string, ScopeMetrics>();

  for (const metric of metrics) {
    const scopeKey = `${metric.scopeName}\0${metric.scopeVersion ?? ""}`;
    let group = map.get(scopeKey);

    if (!group) {
      group = {
        scope: {
          scopeName: metric.scopeName,
          scopeVersion: metric.scopeVersion,
        },
        metrics: [],
      };
      map.set(scopeKey, group);
    }

    group.metrics.push(metric);
  }

  return [...map.values()];
};

const snapshotSums = (
  sums: Map<string, SumMetricBucket>,
  now: string,
): MetricPoint["dataPoints"] => {
  const points: MetricPoint["dataPoints"] = [];

  for (const bucket of sums.values()) {
    points.push({
      attributes: bucket.attributes,
      startTimeUnixNano: bucket.startTimeUnixNano,
      timeUnixNano: now,
      value: bucket.value,
    });
  }

  return points;
};

const snapshotHistograms = (
  histograms: Map<string, HistogramMetricBucket>,
  now: string,
): MetricPoint["dataPoints"] => {
  const points: MetricPoint["dataPoints"] = [];

  for (const bucket of histograms.values()) {
    points.push({
      attributes: bucket.attributes,
      startTimeUnixNano: bucket.startTimeUnixNano,
      timeUnixNano: now,
      value: bucket.sum,
      count: bucket.count,
      sum: bucket.sum,
      min: bucket.min,
      max: bucket.max,
      bucketCounts: [...bucket.bucketCounts],
      explicitBounds: [...HISTOGRAM_EXPLICIT_BOUNDS],
    });
  }

  return points;
};

const snapshotInstrument = (
  instrument: RegisteredInstrument,
  now: string,
): MetricPoint["dataPoints"] => {
  if (instrument.kind === "histogram") {
    return snapshotHistograms(instrument.histograms, now);
  }

  return snapshotSums(instrument.sums, now);
};

export class Tracer {
  public constructor(
    private otel: Otel,
    private scope: Scope,
  ) {}

  public startSpan(name: string, options?: SpanStartOptions): Span {
    const parentCtx = options?.parent ?? this.otel.getActiveContext();
    const parentSpan = parentCtx.span;

    let traceId = randomHex(16);
    let parentSpanId: string | undefined;

    if (parentSpan) {
      traceId = parentSpan.traceId;
      parentSpanId = parentSpan.spanId;
    }

    const spanId = randomHex(8);
    const sampled = this.otel.shouldRecordTrace(traceId, parentSpan);

    let traceFlags = 0;

    if (sampled) {
      traceFlags = TRACE_FLAG_SAMPLED;
    }

    const startMs = options?.startTime ?? Date.now();

    return new Span(this.otel, {
      name,
      traceId,
      spanId,
      parentSpanId,
      traceFlags,
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
    const span = this.startSpan(name, options);
    const ctx: OtelContext = {
      span: span.context(),
    };

    return this.otel.runWithContext(ctx, async () => {
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
  private otel: Otel;

  public constructor(otel: Otel, state: SpanState) {
    this.otel = otel;
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
    return {
      traceId: this.state.traceId,
      spanId: this.state.spanId,
      traceFlags: this.state.traceFlags,
    };
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
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: timeUnixNanoString(this.state.startTimeMs),
      endTimeUnixNano: timeUnixNanoString(endMs),
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      scopeName: this.state.scope.scopeName,
      scopeVersion: this.state.scope.scopeVersion,
    };

    this.otel.onSpanEnded(finished);
  }
}

export class Meter {
  public constructor(
    private otel: Otel,
    private scope: Scope,
  ) {}

  public createCounter(name: string, options?: MetricOptions): Counter {
    return new Counter(this.otel, this.scope, name, options);
  }

  public createUpDownCounter(
    name: string,
    options?: MetricOptions,
  ): UpDownCounter {
    return new UpDownCounter(this.otel, this.scope, name, options);
  }

  public createHistogram(name: string, options?: MetricOptions): Histogram {
    return new Histogram(this.otel, this.scope, name, options);
  }
}

const instrumentKey = (
  scope: Scope,
  name: string,
  kind: InstrumentKind,
): InstrumentKey => {
  return `${scope.scopeName}\0${scope.scopeVersion ?? ""}\0${name}\0${kind}`;
};

export class Counter {
  private handle: InstrumentHandle;

  public constructor(
    otel: Otel,
    scope: Scope,
    name: string,
    options?: MetricOptions,
  ) {
    this.handle = {
      otel,
      scope,
      name,
      options: options ?? {},
    };
  }

  public add(value: number, attributes?: AttributeMap): void {
    const attrs = attributes ?? {};

    this.handle.otel.recordMetric(
      this.handle.scope.scopeName,
      this.handle.scope.scopeVersion,
      instrumentKey(this.handle.scope, this.handle.name, "counter"),
      "counter",
      this.handle.name,
      value,
      attrs,
      this.handle.options,
    );
  }
}

export class UpDownCounter {
  private handle: InstrumentHandle;

  public constructor(
    otel: Otel,
    scope: Scope,
    name: string,
    options?: MetricOptions,
  ) {
    this.handle = {
      otel,
      scope,
      name,
      options: options ?? {},
    };
  }

  public add(value: number, attributes?: AttributeMap): void {
    const attrs = attributes ?? {};

    this.handle.otel.recordMetric(
      this.handle.scope.scopeName,
      this.handle.scope.scopeVersion,
      instrumentKey(this.handle.scope, this.handle.name, "updowncounter"),
      "updowncounter",
      this.handle.name,
      value,
      attrs,
      this.handle.options,
    );
  }
}

export class Histogram {
  private handle: InstrumentHandle;

  public constructor(
    otel: Otel,
    scope: Scope,
    name: string,
    options?: MetricOptions,
  ) {
    this.handle = {
      otel,
      scope,
      name,
      options: options ?? {},
    };
  }

  public record(value: number, attributes?: AttributeMap): void {
    const attrs = attributes ?? {};

    this.handle.otel.recordMetric(
      this.handle.scope.scopeName,
      this.handle.scope.scopeVersion,
      instrumentKey(this.handle.scope, this.handle.name, "histogram"),
      "histogram",
      this.handle.name,
      value,
      attrs,
      this.handle.options,
    );
  }
}

export class Logger {
  public constructor(
    private otel: Otel,
    private scope: Scope,
  ) {}

  public emit(record: LogRecord): void {
    const timeUnixNano = timeUnixNanoString(record.timestamp);

    this.otel.onLogEmitted({
      timeUnixNano,
      severityText: record.severityText,
      body: record.body,
      attributes: record.attributes ?? {},
      scopeName: this.scope.scopeName,
      scopeVersion: this.scope.scopeVersion,
    });
  }
}
