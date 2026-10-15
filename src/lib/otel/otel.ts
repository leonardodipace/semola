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
  SpanContext,
  SumMetricBucket,
} from "./types.js";
import {
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  HISTOGRAM_EXPLICIT_BOUNDS,
  SHUTDOWN_RETRY_DELAYS_MS,
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
  private shutdownTimeoutMs: number;
  private maxQueueSize: number;
  private onExportError: ((error: Error) => void) | undefined;
  private flushChain: Promise<void> = Promise.resolve();

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

    const flushIntervalMs =
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    if (flushIntervalMs < 1) {
      throw new InvalidOptionsError("flushIntervalMs must be at least 1");
    }

    const shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

    if (shutdownTimeoutMs < 0) {
      throw new InvalidOptionsError("shutdownTimeoutMs must be at least 0");
    }

    const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

    if (maxQueueSize < 1) {
      throw new InvalidOptionsError("maxQueueSize must be at least 1");
    }

    this.sampleRatio = ratio;
    this.exportOptions = options.export;
    this.fetchImpl = options.fetch ?? fetch;
    this.flushIntervalMs = flushIntervalMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.maxQueueSize = maxQueueSize;
    this.onExportError = options.onExportError;

    const attributes: AttributeMap = {
      "service.name": options.serviceName,
    };

    if (options.serviceVersion) {
      attributes["service.version"] = options.serviceVersion;
    }

    if (options.serviceInstanceId) {
      attributes["service.instance.id"] = options.serviceInstanceId;
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

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (!this.enabled) {
      this.shutDown = true;
      return;
    }

    const deadline = Date.now() + this.shutdownTimeoutMs;
    let lastError: Error | null = null;
    let attempt = 0;

    while (true) {
      const [error] = await mightThrow(this.flushAll());

      if (!error) {
        this.shutDown = true;
        return;
      }

      if (error instanceof ExportError) {
        lastError = error;
      } else {
        lastError = new ExportError(error.message);
      }

      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        break;
      }

      const delayIndex = Math.min(attempt, SHUTDOWN_RETRY_DELAYS_MS.length - 1);
      const delay = SHUTDOWN_RETRY_DELAYS_MS[delayIndex] ?? 0;
      attempt += 1;

      await Bun.sleep(Math.min(delay, remaining));
    }

    if (lastError) {
      throw lastError;
    }

    throw new ExportError("shutdown flush failed");
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
    this.spanBatch = trimQueue(this.spanBatch, this.maxQueueSize);
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
    this.logBatch = trimQueue(this.logBatch, this.maxQueueSize);
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

    const run = this.flushChain.then(async () => {
      await Promise.all([this.flushTracesAndLogs(), this.flushMetrics()]);
    });

    this.flushChain = settleFlushChain(run);

    await run;
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
    let tracesFailed = false;
    let logsFailed = false;

    if (spans.length > 0) {
      const scopeSpans = groupByScope(
        spans,
        (scope) => ({ scope, spans: [] as FinishedSpan[] }),
        (group, span) => {
          group.spans.push(span);
        },
      );
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
        exportError = toExportError(error);
        tracesFailed = exportError.retryable;
      }
    }

    if (logs.length > 0) {
      const scopeLogs = groupByScope(
        logs,
        (scope) => ({ scope, logRecords: [] as PendingLogRecord[] }),
        (group, record) => {
          group.logRecords.push(record);
        },
      );
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
        const logError = toExportError(error);
        logsFailed = logError.retryable;

        if (!exportError) {
          exportError = logError;
        }
      }
    }

    if (tracesFailed) {
      this.spanBatch = trimQueue(
        spans.concat(this.spanBatch),
        this.maxQueueSize,
      );
    }

    if (logsFailed) {
      this.logBatch = trimQueue(logs.concat(this.logBatch), this.maxQueueSize);
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

    const scopeMetrics = groupByScope(
      points,
      (scope) => ({ scope, metrics: [] as MetricPoint[] }),
      (group, metric) => {
        group.metrics.push(metric);
      },
    );
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
      throw toExportError(error);
    }
  }
}

const toExportError = (error: Error) => {
  if (error instanceof ExportError) {
    return error;
  }

  return new ExportError(error.message);
};

const trimQueue = <T>(items: T[], maxQueueSize: number) => {
  if (items.length <= maxQueueSize) {
    return items;
  }

  return items.slice(items.length - maxQueueSize);
};

const settleFlushChain = (run: Promise<void>) => {
  return run.then(
    () => undefined,
    () => undefined,
  );
};

const scopeKey = (scope: Scope) => {
  return `${scope.scopeName}\0${scope.scopeVersion ?? ""}`;
};

const groupByScope = <
  T extends { scopeName: string; scopeVersion?: string },
  G,
>(
  items: T[],
  createGroup: (scope: Scope) => G,
  append: (group: G, item: T) => void,
): G[] => {
  const map = new Map<string, G>();

  for (const item of items) {
    const scope: Scope = {
      scopeName: item.scopeName,
      scopeVersion: item.scopeVersion,
    };
    const key = scopeKey(scope);
    let group = map.get(key);

    if (!group) {
      group = createGroup(scope);
      map.set(key, group);
    }

    append(group, item);
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
