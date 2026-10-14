import { describe, expect, test } from "bun:test";
import { InvalidOptionsError } from "./errors.js";
import { Meter } from "./meter.js";
import type { AttributeMap, InstrumentKind, MetricRecorder } from "./types.js";

type Recorded = {
  scopeName: string;
  scopeVersion: string | undefined;
  instrumentKey: string;
  kind: InstrumentKind;
  name: string;
  value: number;
  attributes: AttributeMap;
};

const createRecorder = () => {
  const calls: Recorded[] = [];
  const recorder: MetricRecorder = {
    recordMetric: (
      scopeName,
      scopeVersion,
      instrumentKey,
      kind,
      name,
      value,
      attributes,
    ) => {
      calls.push({
        scopeName,
        scopeVersion,
        instrumentKey,
        kind,
        name,
        value,
        attributes,
      });
    },
  };

  return { recorder, calls };
};

describe("Meter", () => {
  test("counter add forwards to recorder", () => {
    const { recorder, calls } = createRecorder();
    const meter = new Meter(recorder, { scopeName: "m", scopeVersion: "1" });

    meter.createCounter("hits").add(2, { route: "/" });

    expect(calls.length).toBe(1);
    expect(calls[0]?.kind).toBe("counter");
    expect(calls[0]?.name).toBe("hits");
    expect(calls[0]?.value).toBe(2);
    expect(calls[0]?.attributes).toEqual({ route: "/" });
    expect(calls[0]?.scopeVersion).toBe("1");
  });

  test("counter rejects negative and non-finite values", () => {
    const { recorder } = createRecorder();
    const counter = new Meter(recorder, { scopeName: "m" }).createCounter("c");

    expect(() => counter.add(-1)).toThrow(InvalidOptionsError);
    expect(() => counter.add(Number.NaN)).toThrow(InvalidOptionsError);
    expect(() => counter.add(Number.POSITIVE_INFINITY)).toThrow(
      InvalidOptionsError,
    );
  });

  test("updown counter accepts negatives", () => {
    const { recorder, calls } = createRecorder();
    new Meter(recorder, { scopeName: "m" })
      .createUpDownCounter("depth")
      .add(-3);

    expect(calls[0]?.kind).toBe("updowncounter");
    expect(calls[0]?.value).toBe(-3);
  });

  test("histogram record forwards value", () => {
    const { recorder, calls } = createRecorder();
    new Meter(recorder, { scopeName: "m" })
      .createHistogram("latency")
      .record(12);

    expect(calls[0]?.kind).toBe("histogram");
    expect(calls[0]?.value).toBe(12);
  });

  test("instruments with different kinds get different keys", () => {
    const { recorder, calls } = createRecorder();
    const meter = new Meter(recorder, { scopeName: "m" });

    meter.createCounter("x").add(1);
    meter.createHistogram("x").record(1);

    expect(calls[0]?.instrumentKey).not.toBe(calls[1]?.instrumentKey);
  });
});
