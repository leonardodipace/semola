import type { DialectSpec } from "./types.js";

export class PlaceholderGenerator {
  private index = 0;

  public constructor(private spec: DialectSpec) {}

  public next() {
    this.index += 1;

    return this.spec.formatPlaceholder(this.index);
  }

  public asFn() {
    return () => this.next();
  }
}
