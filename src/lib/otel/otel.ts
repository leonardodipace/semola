import { mightThrow, mightThrowSync } from "../errors/index.js";
import { ExportError, InvalidOptionsError } from "./errors.js";
import { Logger } from "./logger.js";
import { Meter } from "./meter.js";
import {
  encodeLogsExport,
  encodeMetricsExport,
  encodeTracesExport,
  otlpPost,
} from "./otlp.js";
import { getActiveContext } from "./propagation.js";
import { Tracer } from "./tracer.js";
import type {
  AttributeMap,
  FinishedSpan,
  HistogramMetricBucket,
  InstrumentKind,
  MetricOptions,
  MetricPoint,
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
    requireTrimmed(options.serviceName, "serviceName is required");

    if (options.export.type !== "otlp-http") {
      throw new InvalidOptionsError("export.type must be otlp-http");
    }

    requireTrimmed(options.export.url, "export.url is required");

    const ratio = options.sampleRatio ?? 1;
    requireRange(ratio, 0, 1, "sampleRatio must be between 0 and 1");

    const flushIntervalMs =
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    requireAtLeast(flushIntervalMs, 1, "flushIntervalMs must be at least 1");

    const shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    requireAtLeast(
      shutdownTimeoutMs,
      0,
      "shutdownTimeoutMs must be at least 0",
    );

    const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new InvalidOptionsError(
        "maxQueueSize must be a finite positive integer",
      );
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

    this.startFlushTimer();
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

    const signal =
      this.shutdownTimeoutMs > 0
        ? AbortSignal.timeout(this.shutdownTimeoutMs)
        : undefined;

    const [firstError] = await mightThrow(this.flushAll(signal));

    if (firstError) {
      this.startFlushTimer();
      throw toExportError(firstError);
    }

    this.shutDown = true;

    const [secondError] = await mightThrow(this.flushAll(signal));

    if (secondError) {
      this.shutDown = false;
      this.startFlushTimer();
      throw toExportError(secondError);
    }
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

  public async flushAll(signal?: AbortSignal): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const run = this.flushChain.then(async () => {
      const results = await Promise.allSettled([
        this.flushTracesAndLogs(signal),
        this.flushMetrics(signal),
      ]);

      for (const result of results) {
        if (result.status !== "rejected") {
          continue;
        }

        const reason = result.reason;

        if (reason instanceof Error) {
          throw toExportError(reason);
        }

        throw new ExportError(String(reason));
      }
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

  private startFlushTimer(): void {
    if (this.flushTimer) {
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

  private async flushTracesAndLogs(signal?: AbortSignal): Promise<void> {
    const spans = this.spanBatch;
    const logs = this.logBatch;
    this.spanBatch = [];
    this.logBatch = [];

    if (spans.length === 0 && logs.length === 0) {
      return;
    }

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
      const result = await this.postEncoded(
        () => encodeTracesExport(this.resource, scopeSpans),
        "/v1/traces",
        signal,
      );

      if (result.error) {
        exportError = result.error;
        tracesFailed = result.error.retryable;
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
      const result = await this.postEncoded(
        () => encodeLogsExport(this.resource, scopeLogs),
        "/v1/logs",
        signal,
      );

      if (result.error) {
        logsFailed = result.error.retryable;

        if (!exportError) {
          exportError = result.error;
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

  private async flushMetrics(signal?: AbortSignal): Promise<void> {
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
    const result = await this.postEncoded(
      () => encodeMetricsExport(this.resource, scopeMetrics),
      "/v1/metrics",
      signal,
    );

    if (result.error) {
      throw result.error;
    }
  }

  private async postEncoded(
    encode: () => unknown,
    path: "/v1/traces" | "/v1/metrics" | "/v1/logs",
    signal?: AbortSignal,
  ) {
    const [encodeError, body] = mightThrowSync(encode);

    if (encodeError) {
      return { error: new ExportError(encodeError.message, false) };
    }

    const [error] = await mightThrow(
      otlpPost({
        baseUrl: this.exportOptions.url,
        path,
        body,
        fetch: this.fetchImpl,
        headers: this.exportOptions.headers,
        signal,
      }),
    );

    if (error) {
      return { error: toExportError(error) };
    }

    return { error: null };
  }
}

const requireTrimmed = (value: string, message: string) => {
  if (value.trim()) {
    return;
  }

  throw new InvalidOptionsError(message);
};

const requireRange = (
  value: number,
  min: number,
  max: number,
  message: string,
) => {
  if (value < min) {
    throw new InvalidOptionsError(message);
  }

  if (value > max) {
    throw new InvalidOptionsError(message);
  }
};

const requireAtLeast = (value: number, min: number, message: string) => {
  if (value < min) {
    throw new InvalidOptionsError(message);
  }
};

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

const snapshotInstrument = (
  instrument: RegisteredInstrument,
  now: string,
): MetricPoint["dataPoints"] => {
  if (instrument.kind === "histogram") {
    return snapshotBuckets(instrument.histograms, (bucket) => ({
      attributes: bucket.attributes,
      startTimeUnixNano: bucket.startTimeUnixNano,
      timeUnixNano: now,
      count: bucket.count,
      sum: bucket.sum,
      min: bucket.min,
      max: bucket.max,
      bucketCounts: [...bucket.bucketCounts],
      explicitBounds: [...HISTOGRAM_EXPLICIT_BOUNDS],
    }));
  }

  return snapshotBuckets(instrument.sums, (bucket) => ({
    attributes: bucket.attributes,
    startTimeUnixNano: bucket.startTimeUnixNano,
    timeUnixNano: now,
    value: bucket.value,
  }));
};

const snapshotBuckets = <T extends SumMetricBucket | HistogramMetricBucket>(
  buckets: Map<string, T>,
  mapPoint: (bucket: T) => MetricPoint["dataPoints"][number],
) => {
  const points: MetricPoint["dataPoints"] = [];

  for (const bucket of buckets.values()) {
    points.push(mapPoint(bucket));
  }

  return points;
};
