import { mightThrow } from "../errors/index.js";
import { ExportError, InvalidOptionsError } from "./errors.js";
import { Logger } from "./logger.js";
import { Meter } from "./meter.js";
import {
  encodeLogsExport,
  encodeMetricsExport,
  encodeTracesExport,
  otlpPost,
} from "./otlp.js";
import { getActiveContext, runWithContext } from "./propagation.js";
import { Tracer } from "./tracer.js";
import type {
  AttributeMap,
  FinishedSpan,
  HistogramMetricBucket,
  InstrumentKind,
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
  SumMetricBucket,
} from "./types.js";
import {
  DEFAULT_FLUSH_INTERVAL_MS,
  HISTOGRAM_EXPLICIT_BOUNDS,
  TRACE_FLAG_SAMPLED,
} from "./types.js";
import {
  attributeKey,
  histogramBucketIndex,
  rootTraceSampled,
  timeUnixNanoString,
} from "./util.js";

export class Otel {
  private enabled: boolean;
  private shutDown = false;
  private sampleRatio: number;
  private resource: Resource;
  private exportOptions: OtelOptions["export"];
  private fetchImpl: typeof fetch;
  private spanBatch: FinishedSpan[] = [];
  private logBatch: PendingLogRecord[] = [];
  private metricRegistry = new Map<string, RegisteredInstrument>();
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
    return runWithContext(ctx, fn);
  }

  public getActiveContext(): OtelContext {
    return getActiveContext();
  }

  public shouldRecordTrace(
    traceId: string,
    parent: SpanContext | null,
  ): boolean {
    if (parent) {
      return (parent.traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED;
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

    const active = getActiveContext().span;

    if (active) {
      record.traceId = active.traceId;
      record.spanId = active.spanId;
    }

    this.logBatch.push(record);
  }

  public recordMetric(
    scopeName: string,
    scopeVersion: string | undefined,
    instrumentKey: string,
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

const scopeKey = (scope: Scope) => {
  return `${scope.scopeName}\0${scope.scopeVersion ?? ""}`;
};

const groupSpansByScope = (spans: FinishedSpan[]): ScopeSpans[] => {
  const map = new Map<string, ScopeSpans>();

  for (const span of spans) {
    const scope: Scope = {
      scopeName: span.scopeName,
      scopeVersion: span.scopeVersion,
    };
    const key = scopeKey(scope);
    let group = map.get(key);

    if (!group) {
      group = { scope, spans: [] };
      map.set(key, group);
    }

    group.spans.push(span);
  }

  return [...map.values()];
};

const groupLogsByScope = (logs: PendingLogRecord[]): ScopeLogs[] => {
  const map = new Map<string, ScopeLogs>();

  for (const record of logs) {
    const scope: Scope = {
      scopeName: record.scopeName,
      scopeVersion: record.scopeVersion,
    };
    const key = scopeKey(scope);
    let group = map.get(key);

    if (!group) {
      group = { scope, logRecords: [] };
      map.set(key, group);
    }

    group.logRecords.push(record);
  }

  return [...map.values()];
};

const groupMetricsByScope = (metrics: MetricPoint[]): ScopeMetrics[] => {
  const map = new Map<string, ScopeMetrics>();

  for (const metric of metrics) {
    const scope: Scope = {
      scopeName: metric.scopeName,
      scopeVersion: metric.scopeVersion,
    };
    const key = scopeKey(scope);
    let group = map.get(key);

    if (!group) {
      group = { scope, metrics: [] };
      map.set(key, group);
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
