import type {
  AttributeMap,
  AttributeValue,
  FinishedSpan,
  MetricPoint,
  OtlpAnyValue,
  OtlpInstrumentationScope,
  OtlpKeyValue,
  OtlpPostOptions,
  PendingLogRecord,
  Resource,
  Scope,
  ScopeLogs,
  ScopeMetrics,
  ScopeSpans,
  SpanStatus,
} from "./types.js";

const OTLP_FETCH_TIMEOUT_MS = 10_000;
const OTLP_STATUS_UNSET = 0;
const OTLP_STATUS_OK = 1;
const OTLP_STATUS_ERROR = 2;
const OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
const HTTP_STATUS_OK_MIN = 200;
const HTTP_STATUS_REDIRECT_MIN = 300;

const spanStatusCode = (code: SpanStatus["code"]) => {
  if (code === "OK") {
    return OTLP_STATUS_OK;
  }

  if (code === "ERROR") {
    return OTLP_STATUS_ERROR;
  }

  return OTLP_STATUS_UNSET;
};

const stripTrailingSlash = (url: string) => {
  if (url.endsWith("/")) {
    return url.slice(0, -1);
  }

  return url;
};

const encodeEventAttributes = (attributes: AttributeMap | undefined) => {
  if (!attributes) {
    return [];
  }

  return encodeAttributes(attributes);
};

export const encodeAttributeValue = (value: AttributeValue): OtlpAnyValue => {
  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { intValue: String(value) };
    }

    return { doubleValue: value };
  }

  const values = value.map((entry) => encodeAttributeValue(entry));

  return { arrayValue: { values } };
};

export const encodeAttributes = (map: AttributeMap): OtlpKeyValue[] => {
  const keys = Object.keys(map).sort();
  const pairs: OtlpKeyValue[] = [];

  for (const key of keys) {
    const value = map[key];

    if (value === undefined) {
      continue;
    }

    pairs.push({
      key,
      value: encodeAttributeValue(value),
    });
  }

  return pairs;
};

export const encodeResource = (resource: Resource) => {
  return {
    attributes: encodeAttributes(resource.attributes),
  };
};

export const encodeScope = (scope: Scope): OtlpInstrumentationScope => {
  const encoded: OtlpInstrumentationScope = {
    name: scope.scopeName,
  };

  if (scope.scopeVersion) {
    encoded.version = scope.scopeVersion;
  }

  return encoded;
};

export const encodeSpan = (span: FinishedSpan) => {
  const encoded: Record<string, unknown> = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: encodeAttributes(span.attributes),
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: event.timeUnixNano,
      attributes: encodeEventAttributes(event.attributes),
    })),
    status: {
      code: spanStatusCode(span.status.code),
    },
  };

  if (span.parentSpanId) {
    encoded.parentSpanId = span.parentSpanId;
  }

  if (span.status.message) {
    (encoded.status as Record<string, unknown>).message = span.status.message;
  }

  return encoded;
};

export const encodeTracesExport = (
  resource: Resource,
  scopeSpans: ScopeSpans[],
) => {
  return {
    resourceSpans: [
      {
        resource: encodeResource(resource),
        scopeSpans: scopeSpans.map((group) => ({
          scope: encodeScope(group.scope),
          spans: group.spans.map(encodeSpan),
        })),
      },
    ],
  };
};

export const encodeLogRecord = (record: PendingLogRecord) => {
  const encoded: Record<string, unknown> = {
    timeUnixNano: record.timeUnixNano,
    severityText: record.severityText,
    body: { stringValue: record.body },
    attributes: encodeAttributes(record.attributes),
  };

  if (record.traceId) {
    encoded.traceId = record.traceId;
  }

  if (record.spanId) {
    encoded.spanId = record.spanId;
  }

  return encoded;
};

export const encodeLogsExport = (
  resource: Resource,
  scopeLogs: ScopeLogs[],
) => {
  return {
    resourceLogs: [
      {
        resource: encodeResource(resource),
        scopeLogs: scopeLogs.map((group) => ({
          scope: encodeScope(group.scope),
          logRecords: group.logRecords.map(encodeLogRecord),
        })),
      },
    ],
  };
};

export const encodeMetric = (point: MetricPoint) => {
  if (point.kind === "histogram") {
    const bucketCounts = point.dataPoints.map((dp) => {
      const counts = dp.bucketCounts ?? [];

      return {
        attributes: encodeAttributes(dp.attributes),
        startTimeUnixNano: dp.startTimeUnixNano,
        timeUnixNano: dp.timeUnixNano,
        count: String(dp.count ?? 0),
        sum: dp.sum ?? 0,
        min: dp.min,
        max: dp.max,
        bucketCounts: counts.map((count) => String(count)),
        explicitBounds: dp.explicitBounds,
      };
    });

    return {
      name: point.name,
      description: point.description,
      unit: point.unit,
      histogram: {
        aggregationTemporality: OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE,
        dataPoints: bucketCounts,
      },
    };
  }

  let isMonotonic = false;

  if (point.kind === "counter") {
    isMonotonic = true;
  }

  return {
    name: point.name,
    description: point.description,
    unit: point.unit,
    sum: {
      aggregationTemporality: OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE,
      isMonotonic,
      dataPoints: point.dataPoints.map((dp) => ({
        attributes: encodeAttributes(dp.attributes),
        startTimeUnixNano: dp.startTimeUnixNano,
        timeUnixNano: dp.timeUnixNano,
        asDouble: dp.value,
      })),
    },
  };
};

export const encodeMetricsExport = (
  resource: Resource,
  scopeMetrics: ScopeMetrics[],
) => {
  return {
    resourceMetrics: [
      {
        resource: encodeResource(resource),
        scopeMetrics: scopeMetrics.map((group) => ({
          scope: encodeScope(group.scope),
          metrics: group.metrics.map(encodeMetric),
        })),
      },
    ],
  };
};

export const otlpPost = async (options: OtlpPostOptions) => {
  const base = stripTrailingSlash(options.baseUrl);
  const url = `${base}${options.path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await options.fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(OTLP_FETCH_TIMEOUT_MS),
  });

  await response.body?.cancel();

  if (response.status < HTTP_STATUS_OK_MIN) {
    throw new Error(`OTLP export failed with status ${response.status}`);
  }

  if (response.status >= HTTP_STATUS_REDIRECT_MIN) {
    throw new Error(`OTLP export failed with status ${response.status}`);
  }
};
