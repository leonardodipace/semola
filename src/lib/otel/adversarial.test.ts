import { describe, expect, test } from "bun:test";
import { inject, Otel } from "./index.js";
import {
  baseOptions,
  createMockFetch,
  parseBody,
  pathCallCount,
  traceSpans,
} from "./test-fixtures.js";

describe("adversarial sampling volume", () => {
  test("fractional ratio 0.01 still exports at least one root sometimes", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({ ...baseOptions(fetch), sampleRatio: 0.01 });

    for (let index = 0; index < 1000; index++) {
      await otel.tracer("s").startActiveSpan(`r-${index}`, async () => {});
    }

    await otel.shutdown();

    const exported =
      pathCallCount(calls, "/v1/traces") > 0 ? traceSpans(calls).length : 0;
    expect(exported).toBeGreaterThan(0);
    expect(exported).toBeLessThan(1000);
  });
});

describe("adversarial multi-replica isolation", () => {
  test("two Otel instances keep separate batches context and metrics", async () => {
    const mockA = createMockFetch();
    const mockB = createMockFetch();
    const otelA = new Otel({
      ...baseOptions(mockA.fetch),
      serviceInstanceId: "replica-a",
    });
    const otelB = new Otel({
      ...baseOptions(mockB.fetch),
      serviceInstanceId: "replica-b",
    });

    await otelA.tracer("a").startActiveSpan("a-span", async () => {
      otelA.meter("m").createCounter("hits").add(1);
      const carrier: Record<string, string> = {};
      inject(carrier);
      expect(carrier.traceparent).toBeDefined();
    });

    await otelB.tracer("b").startActiveSpan("b-span", async () => {
      otelB.meter("m").createCounter("hits").add(5);
      const carrier: Record<string, string> = {};
      inject(carrier);
      expect(carrier.traceparent).toBeDefined();
    });

    await Promise.all([otelA.shutdown(), otelB.shutdown()]);

    expect(pathCallCount(mockA.calls, "/v1/traces")).toBeGreaterThan(0);
    expect(pathCallCount(mockB.calls, "/v1/traces")).toBeGreaterThan(0);
    expect(traceSpans(mockA.calls).some((span) => span.name === "a-span")).toBe(
      true,
    );
    expect(traceSpans(mockB.calls).some((span) => span.name === "b-span")).toBe(
      true,
    );

    const metricValue = (calls: typeof mockA.calls) =>
      parseBody(calls.find((call) => call.url.endsWith("/v1/metrics")))
        .resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;

    expect(metricValue(mockA.calls)).toBe(1);
    expect(metricValue(mockB.calls)).toBe(5);
  });
});
