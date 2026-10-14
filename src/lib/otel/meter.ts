import { InvalidOptionsError } from "./errors.js";
import type {
  AttributeMap,
  InstrumentHandle,
  InstrumentKind,
  MetricOptions,
  MetricRecorder,
  Scope,
} from "./types.js";

const instrumentKey = (scope: Scope, name: string, kind: InstrumentKind) => {
  return `${scope.scopeName}\0${scope.scopeVersion ?? ""}\0${name}\0${kind}`;
};

class MetricInstrument {
  protected handle: InstrumentHandle;

  public constructor(
    otel: MetricRecorder,
    scope: Scope,
    name: string,
    kind: InstrumentKind,
    options?: MetricOptions,
  ) {
    this.handle = {
      otel,
      scope,
      name,
      kind,
      options: options ?? {},
    };
  }

  protected write(value: number, attributes?: AttributeMap) {
    this.handle.otel.recordMetric(
      this.handle.scope.scopeName,
      this.handle.scope.scopeVersion,
      instrumentKey(this.handle.scope, this.handle.name, this.handle.kind),
      this.handle.kind,
      this.handle.name,
      value,
      attributes ?? {},
      this.handle.options,
    );
  }
}

export class Counter extends MetricInstrument {
  public constructor(
    otel: MetricRecorder,
    scope: Scope,
    name: string,
    options?: MetricOptions,
  ) {
    super(otel, scope, name, "counter", options);
  }

  public add(value: number, attributes?: AttributeMap) {
    if (!Number.isFinite(value)) {
      throw new InvalidOptionsError(
        "Counter.add value must be a finite number",
      );
    }

    if (value < 0) {
      throw new InvalidOptionsError("Counter.add value must be non-negative");
    }

    this.write(value, attributes);
  }
}

export class UpDownCounter extends MetricInstrument {
  public constructor(
    otel: MetricRecorder,
    scope: Scope,
    name: string,
    options?: MetricOptions,
  ) {
    super(otel, scope, name, "updowncounter", options);
  }

  public add(value: number, attributes?: AttributeMap) {
    this.write(value, attributes);
  }
}

export class Histogram extends MetricInstrument {
  public constructor(
    otel: MetricRecorder,
    scope: Scope,
    name: string,
    options?: MetricOptions,
  ) {
    super(otel, scope, name, "histogram", options);
  }

  public record(value: number, attributes?: AttributeMap) {
    this.write(value, attributes);
  }
}

export class Meter {
  public constructor(
    private otel: MetricRecorder,
    private scope: Scope,
  ) {}

  public createCounter(name: string, options?: MetricOptions): Counter {
    return new Counter(this.otel, this.scope, name, options);
  }

  public createUpDownCounter(
    name: string,
    options?: MetricOptions,
  ): UpDownCounter {
    return new UpDownCounter(this.otel, this.scope, name, options);
  }

  public createHistogram(name: string, options?: MetricOptions): Histogram {
    return new Histogram(this.otel, this.scope, name, options);
  }
}
