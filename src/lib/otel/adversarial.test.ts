import { describe, expect, test } from "bun:test";
import { inject, Otel } from "./index.js";
import {
  baseOptions,
  createMockFetch,
  type FetchCall,
  parseBody,
} from "./test-fixtures.js";

const traceSpans = (calls: FetchCall[]) => {
  const call = calls.find((entry) => entry.url.endsWith("/v1/traces"));
  const body = parseBody(call);
  return body.resourceSpans[0].scopeSpans[0].spans as Array<{
    name: string;
  }>;
};

describe("adversarial sampling volume", () => {
  test("fractional ratio 0.01 still exports at least one root sometimes", async () => {
    const { fetch, calls } = createMockFetch();
    const otel = new Otel({
      ...baseOptions(fetch),
      sampleRatio: 0.01,
    });

    for (let index = 0; index < 1000; index++) {
      await otel.tracer("s").startActiveSpan(`r-${index}`, async () => {});
    }

    await otel.shutdown();

    const hasTracePost = calls.some((call) => call.url.endsWith("/v1/traces"));
    const exported = hasTracePost ? traceSpans(calls).length : 0;
    expect(exported).toBeGreaterThan(0);
    expect(exported).toBeLessThan(1000);
  });
});

describe("adversarial multi-replica isolation", () => {
  test("two Otel instances use separate fetch batches", async () => {
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

    await otelA.tracer("a").startActiveSpan("only-a", async () => {});
    await otelB.tracer("b").startActiveSpan("only-b", async () => {});

    await otelA.shutdown();
    await otelB.shutdown();

    expect(mockA.calls.length).toBeGreaterThan(0);
    expect(mockB.calls.length).toBeGreaterThan(0);

    const bodyA = parseBody(
      mockA.calls.find((call) => call.url.endsWith("/v1/traces")),
    );
    const bodyB = parseBody(
      mockB.calls.find((call) => call.url.endsWith("/v1/traces")),
    );

    const attrsA = bodyA.resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;
    const attrsB = bodyB.resourceSpans[0].resource.attributes as Array<{
      key: string;
      value: { stringValue?: string };
    }>;

    expect(
      attrsA.find((attr) => attr.key === "service.instance.id")?.value
        .stringValue,
    ).toBe("replica-a");
    expect(
      attrsB.find((attr) => attr.key === "service.instance.id")?.value
        .stringValue,
    ).toBe("replica-b");
  });

  test("inject context on replica A does not affect replica B", async () => {
    const mockA = createMockFetch();
    const mockB = createMockFetch();
    const otelA = new Otel(baseOptions(mockA.fetch));
    const otelB = new Otel(baseOptions(mockB.fetch));

    await otelA.tracer("a").startActiveSpan("iso", async () => {
      const out: Record<string, string> = {};
      inject(out);
      expect(out.traceparent).toBeTruthy();
    });

    const carrier: Record<string, string> = {};
    inject(carrier);
    expect(carrier.traceparent).toBeUndefined();

    await otelA.shutdown();
    await otelB.shutdown();
  });

  test("metrics counters on two instances stay independent", async () => {
    const mockA = createMockFetch();
    const mockB = createMockFetch();
    const otelA = new Otel(baseOptions(mockA.fetch));
    const otelB = new Otel(baseOptions(mockB.fetch));

    otelA.meter("m").createCounter("hits").add(2);
    otelB.meter("m").createCounter("hits").add(5);

    await otelA.shutdown();
    await otelB.shutdown();

    const bodyA = parseBody(
      mockA.calls.find((call) => call.url.endsWith("/v1/metrics")),
    );
    const bodyB = parseBody(
      mockB.calls.find((call) => call.url.endsWith("/v1/metrics")),
    );

    const valueA =
      bodyA.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;
    const valueB =
      bodyB.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]
        .asDouble;

    expect(valueA).toBe(2);
    expect(valueB).toBe(5);
  });
});
