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
const OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE = 2;

const spanStatusCode = (code: SpanStatus["code"]) => {
  if (code === "OK") {
    return 1;
  }

  if (code === "ERROR") {
    return 2;
  }

  return 0;
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
      attributes: encodeAttributes(event.attributes ?? {}),
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
        resource: {
          attributes: encodeAttributes(resource.attributes),
        },
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
        resource: {
          attributes: encodeAttributes(resource.attributes),
        },
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
    return {
      name: point.name,
      description: point.description,
      unit: point.unit,
      histogram: {
        aggregationTemporality: OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE,
        dataPoints: point.dataPoints.map((dp) => ({
          attributes: encodeAttributes(dp.attributes),
          startTimeUnixNano: dp.startTimeUnixNano,
          timeUnixNano: dp.timeUnixNano,
          count: String(dp.count ?? 0),
          sum: dp.sum ?? 0,
          min: dp.min,
          max: dp.max,
          bucketCounts: (dp.bucketCounts ?? []).map((count) => String(count)),
          explicitBounds: dp.explicitBounds,
        })),
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
        resource: {
          attributes: encodeAttributes(resource.attributes),
        },
        scopeMetrics: scopeMetrics.map((group) => ({
          scope: encodeScope(group.scope),
          metrics: group.metrics.map(encodeMetric),
        })),
      },
    ],
  };
};

export const otlpPost = async (options: OtlpPostOptions) => {
  let base = options.baseUrl;

  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await options.fetch(`${base}${options.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(OTLP_FETCH_TIMEOUT_MS),
  });

  await response.body?.cancel();

  if (!response.ok) {
    throw new Error(`OTLP export failed with status ${response.status}`);
  }
};
