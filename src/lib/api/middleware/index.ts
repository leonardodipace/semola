import type { RequestSchema, ResponseSchema } from "../core/types.js";
import type { MiddlewareOptions } from "./types.js";

export class Middleware<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
  TExtension extends Record<string, unknown> = Record<string, unknown>,
> {
  public constructor(
    public options: MiddlewareOptions<TRequest, TResponse, TExtension>,
  ) {}
}
