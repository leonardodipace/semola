export type OtelOptions = {
  serviceName: string;
  serviceVersion?: string;
  export: OtlpHttpExport;
  sampleRatio?: number;
  enabled?: boolean;
  flushIntervalMs?: number;
  fetch?: typeof fetch;
  onExportError?: (error: Error) => void;
};

export type OtlpHttpExport = {
  type: "otlp-http";
  url: string;
  headers?: Record<string, string>;
};

export type LogSeverity =
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL";

export type SpanStatus = {
  code: "UNSET" | "OK" | "ERROR";
  message?: string;
};

export type SpanContext = {
  traceId: string;
  spanId: string;
  traceFlags: number;
};

export type TraceCarrier = Headers | Record<string, string>;

export type OtelContext = {
  span: SpanContext | null;
};

export type SpanStartOptions = {
  parent?: OtelContext;
  attributes?: AttributeMap;
  startTime?: number;
};

export type SpanApi = {
  setAttribute: (key: string, value: AttributeValue) => void;
  addEvent: (name: string, attributes?: AttributeMap) => void;
  recordException: (err: Error) => void;
  setStatus: (status: SpanStatus) => void;
  context: () => SpanContext;
  end: (endTime?: number) => void;
};

export type ActiveSpanCallback<T> = (span: SpanApi) => T | Promise<T>;

export type LogRecord = {
  severityText: LogSeverity | string;
  body: string;
  attributes?: AttributeMap;
  timestamp?: number;
};

export type AttributeMap = Record<string, AttributeValue>;

export type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export type MetricOptions = {
  description?: string;
  unit?: string;
};

export type Resource = {
  attributes: AttributeMap;
};

export type Scope = {
  scopeName: string;
  scopeVersion?: string;
};

export type InstrumentKind = "counter" | "updowncounter" | "histogram";

export type FinishedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: AttributeMap;
  events: SpanEvent[];
  status: SpanStatus;
  scopeName: string;
  scopeVersion?: string;
};

export type SpanEvent = {
  name: string;
  timeUnixNano: string;
  attributes?: AttributeMap;
};

export type PendingLogRecord = {
  timeUnixNano: string;
  severityText: string;
  body: string;
  attributes: AttributeMap;
  traceId?: string;
  spanId?: string;
  scopeName: string;
  scopeVersion?: string;
};

export type MetricDataPoint = {
  attributes: AttributeMap;
  startTimeUnixNano?: string;
  timeUnixNano: string;
  value: number;
  count?: number;
  sum?: number;
  min?: number;
  max?: number;
  bucketCounts?: number[];
  explicitBounds?: number[];
};

export type MetricPoint = {
  name: string;
  kind: InstrumentKind;
  unit?: string;
  description?: string;
  scopeName: string;
  scopeVersion?: string;
  dataPoints: MetricDataPoint[];
};

export type ScopeSpans = {
  scope: Scope;
  spans: FinishedSpan[];
};

export type ScopeLogs = {
  scope: Scope;
  logRecords: PendingLogRecord[];
};

export type ScopeMetrics = {
  scope: Scope;
  metrics: MetricPoint[];
};

export type OtlpPostOptions = {
  baseUrl: string;
  path: "/v1/traces" | "/v1/metrics" | "/v1/logs";
  body: unknown;
  fetch: typeof fetch;
  headers?: Record<string, string>;
};

export type OtlpKeyValue = {
  key: string;
  value: OtlpAnyValue;
};

export type OtlpInstrumentationScope = {
  name: string;
  version?: string;
};

export type OtlpAnyValue = {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpAnyValue[] };
};

export const HISTOGRAM_EXPLICIT_BOUNDS: readonly number[] = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 1000,
];

export const DEFAULT_FLUSH_INTERVAL_MS = 5000;

export const TRACE_FLAG_SAMPLED = 0x01;

export type SumMetricBucket = {
  attributes: AttributeMap;
  value: number;
  startTimeUnixNano: string;
};

export type HistogramMetricBucket = {
  attributes: AttributeMap;
  count: number;
  sum: number;
  min: number;
  max: number;
  bucketCounts: number[];
  startTimeUnixNano: string;
};

export type SpanState = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
  dropped: boolean;
  scope: Scope;
  startTimeMs: number;
  initialAttributes?: AttributeMap;
};

export type MetricRecorder = {
  recordMetric: (
    scopeName: string,
    scopeVersion: string | undefined,
    instrumentKey: string,
    kind: InstrumentKind,
    name: string,
    value: number,
    attributes: AttributeMap,
    options: MetricOptions,
  ) => void;
};

export type InstrumentHandle = {
  otel: MetricRecorder;
  scope: Scope;
  name: string;
  kind: InstrumentKind;
  options: MetricOptions;
};

export type RegisteredInstrument = {
  kind: InstrumentKind;
  name: string;
  scopeName: string;
  scopeVersion?: string;
  unit?: string;
  description?: string;
  sums: Map<string, SumMetricBucket>;
  histograms: Map<string, HistogramMetricBucket>;
};
