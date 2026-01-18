import type { MiddlewareOptions } from "./types.js";

export class Middleware {
  private options: MiddlewareOptions;

  public constructor(options: MiddlewareOptions) {
    this.options = options;
  }
}
