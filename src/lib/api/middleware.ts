import type { HandlerContext, RequestSchema, ResponseSchema } from "./types.js";

export type MiddlewareData = Record<string, unknown>;

export type MiddlewareResult<TData extends MiddlewareData = MiddlewareData> =
  | Response
  | TData;

export type MiddlewareHandler<
  TRequest extends RequestSchema,
  TResponse extends ResponseSchema,
  TData extends MiddlewareData,
> = (
  context: HandlerContext<TRequest, TResponse>,
) => Promise<MiddlewareResult<TData>> | MiddlewareResult<TData>;

export type MiddlewareDefinition<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
  TData extends MiddlewareData = MiddlewareData,
> = {
  request?: TRequest;
  response?: TResponse;
  handler: MiddlewareHandler<TRequest, TResponse, TData>;
};

export class Middleware<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
  TData extends MiddlewareData = MiddlewareData,
> {
  public readonly definition: MiddlewareDefinition<TRequest, TResponse, TData>;

  public constructor(
    definition: MiddlewareDefinition<TRequest, TResponse, TData>,
  ) {
    this.definition = definition;
  }
}

// Type inference helpers
export type InferMiddlewareData<T> =
  T extends Middleware<any, any, infer TData> ? TData : never;

export type MergeMiddlewareData<T extends readonly any[]> = T extends readonly [
  infer First,
  ...infer Rest,
]
  ? (First extends Middleware<any, any, infer TData> ? TData : {}) &
      MergeMiddlewareData<Rest>
  : {};
