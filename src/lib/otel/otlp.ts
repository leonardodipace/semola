import type {
  AttributeMap,
  AttributeValue,
  FinishedSpan,
  MetricPoint,
  OtlpAnyValue,
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

function spanStatusCode(code: SpanStatus["code"]): number {
  if (code === "OK") {
    return 1;
  }

  if (code === "ERROR") {
    return 2;
  }

  return 0;
}

export function encodeAttributeValue(value: AttributeValue): OtlpAnyValue {
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
}

export function encodeAttributes(map: AttributeMap): OtlpKeyValue[] {
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
}

export function encodeResource(resource: Resource) {
  return {
    attributes: encodeAttributes(resource.attributes),
  };
}

export function encodeScope(scope: Scope) {
  const encoded: { name: string; version?: string } = {
    name: scope.scopeName,
  };

  if (scope.scopeVersion) {
    encoded.version = scope.scopeVersion;
  }

  return encoded;
}

export function encodeSpan(span: FinishedSpan) {
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
      attributes: event.attributes ? encodeAttributes(event.attributes) : [],
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
}

export function encodeTracesExport(
  resource: Resource,
  scopeSpans: ScopeSpans[],
) {
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
}

export function encodeLogRecord(record: PendingLogRecord) {
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
}

export function encodeLogsExport(resource: Resource, scopeLogs: ScopeLogs[]) {
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
}

export function encodeMetric(point: MetricPoint) {
  if (point.kind === "histogram") {
    return {
      name: point.name,
      description: point.description,
      unit: point.unit,
      histogram: {
        aggregationTemporality: 2,
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

  return {
    name: point.name,
    description: point.description,
    unit: point.unit,
    sum: {
      aggregationTemporality: 2,
      isMonotonic: point.kind === "counter",
      dataPoints: point.dataPoints.map((dp) => ({
        attributes: encodeAttributes(dp.attributes),
        startTimeUnixNano: dp.startTimeUnixNano,
        timeUnixNano: dp.timeUnixNano,
        asDouble: dp.value,
      })),
    },
  };
}

export function encodeMetricsExport(
  resource: Resource,
  scopeMetrics: ScopeMetrics[],
) {
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
}

export async function otlpPost(options: OtlpPostOptions): Promise<void> {
  const base = options.baseUrl.replace(/\/$/, "");
  const url = `${base}${options.path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await options.fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });

  await response.body?.cancel();

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`OTLP export failed with status ${response.status}`);
  }
}
