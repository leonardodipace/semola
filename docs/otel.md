---
title: Otel
description: Zero-dependency OTLP/HTTP JSON traces, metrics, and logs
---

Export OpenTelemetry signals without pulling in `@opentelemetry/*`. Uses OTLP/HTTP with JSON bodies, W3C trace context, and a single `Otel` root you shut down at process exit.

## Import

```typescript
import { Otel, inject, extract } from "semola/otel";
```

## Quick start

```typescript
const otel = new Otel({
  serviceName: "orders",
  export: { type: "otlp-http", url: "http://localhost:4318" },
  sampleRatio: 1,
  enabled: true,
});

const tracer = otel.tracer("checkout");

await tracer.startActiveSpan("charge", async (span) => {
  span.setAttribute("order.id", orderId);
  span.addEvent("authorized");

  const meter = otel.meter("checkout");
  meter.createCounter("orders.paid").add(1, { currency: "USD" });
  meter.createHistogram("charge.duration_ms").record(durationMs);

  otel.logger("checkout").emit({
    severityText: "INFO",
    body: "charged",
    attributes: { orderId },
  });
});

await otel.shutdown();
```

Point `export.url` at an OTLP HTTP receiver (default paths: `/v1/traces`, `/v1/metrics`, `/v1/logs` under that base).

## Traces

`otel.tracer(scopeName)` returns a tracer for that instrumentation scope. Prefer `startActiveSpan` so the span becomes the active context for nested work and for `inject`.

```typescript
await tracer.startActiveSpan("work", async (span) => {
  span.setAttribute("key", "value");
  span.addEvent("step.done", { step: "validate" });
});

await tracer.startActiveSpan("risky", async (span) => {
  try {
    await charge();
  } catch (err) {
    if (err instanceof Error) {
      span.recordException(err);
      span.setStatus({ code: "ERROR", message: err.message });
    } else {
      span.setStatus({ code: "ERROR", message: String(err) });
    }

    throw err;
  }
});
```

Manual spans (no active context switch):

```typescript
const span = tracer.startSpan("background");
span.end();
```

Pass a remote parent from incoming headers:

```typescript
const parent = extract(request.headers);

await tracer.startActiveSpan(
  "handle",
  async (span) => {
    /* ... */
  },
  { parent },
);
```

## Propagation

`inject` writes W3C `traceparent` from the current async context into a `Headers` instance or a plain record.

```typescript
const headers: Record<string, string> = {};
inject(headers);
await fetch(upstream, { headers });
```

`extract` reads W3C `traceparent` from incoming headers and returns a parent context for `startActiveSpan` options. Invalid headers yield an empty parent.

## Metrics

Counters, up-down counters, and histograms. Create them on a meter, then call `add` or `record`.

```typescript
const meter = otel.meter("checkout");

const paid = meter.createCounter("orders.paid", {
  description: "Successful charges",
});
paid.add(1, { currency: "USD" });

const queueDepth = meter.createUpDownCounter("queue.depth");
queueDepth.add(-1);

const latency = meter.createHistogram("charge.duration_ms");
latency.record(12, { region: "us-east" });
```

Histograms use fixed explicit bucket bounds (`HISTOGRAM_EXPLICIT_BOUNDS`, exported from `semola/otel`). Metrics flush on the same periodic schedule as trace and log batching.

## Logs

Loggers are scope-named emitters. Records carry a severity text (`TRACE` through `FATAL`, or any string), body, and attributes. They export as OTLP log records and share the trace context active when `emit` runs.

```typescript
otel.logger("checkout").emit({
  severityText: "WARN",
  body: "retry scheduled",
  attributes: { attempt: 2 },
});
```

## Sampling

When a parent span context exists (local ALS or `extract`), children always follow that parent's sampled flag. Root spans use `sampleRatio`: `1` keeps all roots, `0` drops all roots, and values in between sample roots deterministically from the trace id. Unsampled spans are no-ops and are not exported.

## Soft-disable

When `enabled: false`, construction succeeds but tracers, meters, and loggers become no-ops: no batches, no timers, no network I/O. `shutdown()` resolves immediately.

```typescript
const otel = new Otel({
  serviceName: "orders",
  export: { type: "otlp-http", url: "http://localhost:4318" },
  enabled: false,
});
```

## Shutdown

Call `shutdown()` before exit so batches flush and the periodic timer stops. A second `shutdown()` is a no-op. After shutdown, recording behaves like `enabled: false`.

```typescript
await otel.shutdown();
```

## Options (summary)

| Option | Role |
|--------|------|
| `serviceName` | Required resource `service.name` |
| `export` | `{ type: "otlp-http", url, headers? }` base URL for OTLP HTTP |
| `sampleRatio` | `0..1`, default `1` |
| `enabled` | When `false`, full no-op |
| `flushIntervalMs` | Batch flush period (default 5000 ms) |
| `serviceVersion` | Optional resource attribute |
| `fetch` | Optional `fetch` override for tests or proxies |
| `onExportError` | Called when a periodic flush fails (does not rethrow) |

Metrics use cumulative aggregation. Values keep growing across flushes until process exit.
