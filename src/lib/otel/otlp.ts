import { mightThrow, mightThrowSync } from "../errors/index.js";
import { ExportError } from "./errors.js";
import type {
  AttributeMap,
  AttributeValue,
  FinishedSpan,
  MetricPoint,
  OtlpAnyValue,
  OtlpInstrumentationScope,
  OtlpKeyValue,
  OtlpPostOptions,
  OtlpSpanStatus,
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
const OTLP_RETRY_DELAYS_MS = [0, 25, 75] as const;
const OTLP_PARTIAL_SUCCESS_BODY_LIMIT = 65_536;
const OTLP_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const REJECTED_COUNT_KEYS = [
  "rejectedSpans",
  "rejected_spans",
  "rejectedLogRecords",
  "rejected_log_records",
  "rejectedDataPoints",
  "rejected_data_points",
] as const;

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

const encodeScope = (scope: Scope): OtlpInstrumentationScope => {
  const encoded: OtlpInstrumentationScope = {
    name: scope.scopeName,
  };

  if (scope.scopeVersion) {
    encoded.version = scope.scopeVersion;
  }

  return encoded;
};

export const encodeSpan = (span: FinishedSpan) => {
  const status: OtlpSpanStatus = {
    code: spanStatusCode(span.status.code),
  };

  if (span.status.message) {
    status.message = span.status.message;
  }

  const encoded: Record<string, unknown> = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: span.kind,
    flags: span.flags,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: encodeAttributes(span.attributes),
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: event.timeUnixNano,
      attributes: encodeAttributes(event.attributes ?? {}),
    })),
    status,
  };

  if (span.parentSpanId) {
    encoded.parentSpanId = span.parentSpanId;
  }

  if (span.traceState) {
    encoded.traceState = span.traceState;
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

  if (record.severityNumber !== undefined) {
    encoded.severityNumber = record.severityNumber;
  }

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

const joinOtlpUrl = (baseUrl: string, path: string) => {
  const base = `${baseUrl.replace(/\/+$/, "")}/`;
  const relative = path.replace(/^\/+/, "");

  return new URL(relative, base).href;
};

const rejectedCountFromPartial = (partial: object) => {
  const record = partial as Record<string, unknown>;

  for (const key of REJECTED_COUNT_KEYS) {
    const value = record[key];

    if (typeof value === "number") {
      if (value > 0) {
        return value;
      }
    }

    if (typeof value === "string") {
      const parsed = Number(value);

      if (parsed > 0) {
        return parsed;
      }
    }
  }

  return 0;
};

const readResponseTextBounded = async (response: Response, limit: number) => {
  const body = response.body;

  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;

  while (true) {
    const [readError, chunk] = await mightThrow(reader.read());

    if (readError) {
      throw new ExportError(readError.message, false);
    }

    const { done, value } = chunk;

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > limit) {
      await reader.cancel();
      throw new ExportError("OTLP response body exceeds size limit", false);
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
};

const assertNoPartialRejection = async (response: Response) => {
  const text = await readResponseTextBounded(
    response,
    OTLP_PARTIAL_SUCCESS_BODY_LIMIT,
  );

  if (!text) {
    return;
  }

  const [parseError, parsed] = mightThrowSync(() => JSON.parse(text));

  if (parseError) {
    return;
  }

  if (typeof parsed !== "object") {
    return;
  }

  if (parsed === null) {
    return;
  }

  const body = parsed as Record<string, unknown>;
  const partial = body.partialSuccess ?? body["partial_success"];

  if (typeof partial !== "object") {
    return;
  }

  if (partial === null) {
    return;
  }

  const rejected = rejectedCountFromPartial(partial);

  if (rejected === 0) {
    return;
  }

  throw new ExportError(
    `OTLP partial success rejected ${rejected} records`,
    false,
  );
};

const fetchSignal = (signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(OTLP_FETCH_TIMEOUT_MS);

  if (!signal) {
    return timeout;
  }

  return AbortSignal.any([timeout, signal]);
};

export const otlpPost = async (options: OtlpPostOptions) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const url = joinOtlpUrl(options.baseUrl, options.path);
  const body = JSON.stringify(options.body);
  let lastError: ExportError | null = null;

  for (const delayMs of OTLP_RETRY_DELAYS_MS) {
    if (options.signal?.aborted) {
      throw lastError ?? new ExportError("OTLP export aborted", false);
    }

    if (delayMs > 0) {
      await Bun.sleep(delayMs);

      if (options.signal?.aborted) {
        throw lastError ?? new ExportError("OTLP export aborted", false);
      }
    }

    const [error, response] = await mightThrow(
      options.fetch(url, {
        method: "POST",
        headers,
        body,
        signal: fetchSignal(options.signal),
      }),
    );

    if (error) {
      lastError = new ExportError(error.message, true);

      if (options.signal?.aborted) {
        throw lastError;
      }

      continue;
    }

    if (response.ok) {
      await assertNoPartialRejection(response);
      return;
    }

    await response.body?.cancel();

    const retryable = OTLP_RETRY_STATUSES.has(response.status);
    lastError = new ExportError(
      `OTLP export failed with status ${response.status}`,
      retryable,
    );

    if (!retryable) {
      throw lastError;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new ExportError("OTLP export failed", true);
};
