import type {
  MiddlewareOptions,
  RequestSchema,
  ResponseSchema,
} from "./types.js";

export class Middleware<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
  TExtension extends Record<string, unknown> = Record<string, unknown>,
> {
  public constructor(
    public options: MiddlewareOptions<TRequest, TResponse, TExtension>,
  ) {}
}
