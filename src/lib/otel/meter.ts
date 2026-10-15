import { InvalidOptionsError } from "./errors.js";
import type {
  AttributeMap,
  InstrumentKind,
  MetricOptions,
  MetricRecorder,
  Scope,
} from "./types.js";

const instrumentKey = (scope: Scope, name: string, kind: InstrumentKind) => {
  return `${scope.scopeName}\0${scope.scopeVersion ?? ""}\0${name}\0${kind}`;
};

class MetricInstrument {
  protected otel: MetricRecorder;
  protected scope: Scope;
  protected name: string;
  protected kind: InstrumentKind;
  protected options: MetricOptions;

  public constructor(
    otel: MetricRecorder,
    scope: Scope,
    name: string,
    kind: InstrumentKind,
    options?: MetricOptions,
  ) {
    this.otel = otel;
    this.scope = scope;
    this.name = name;
    this.kind = kind;
    this.options = options ?? {};
  }

  protected write(value: number, attributes?: AttributeMap) {
    this.otel.recordMetric(
      this.scope.scopeName,
      this.scope.scopeVersion,
      instrumentKey(this.scope, this.name, this.kind),
      this.kind,
      this.name,
      value,
      attributes ?? {},
      this.options,
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
    if (!Number.isFinite(value)) {
      throw new InvalidOptionsError(
        "UpDownCounter.add value must be a finite number",
      );
    }

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
    if (!Number.isFinite(value)) {
      throw new InvalidOptionsError(
        "Histogram.record value must be a finite number",
      );
    }

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
