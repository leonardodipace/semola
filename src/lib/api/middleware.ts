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
  private definition: MiddlewareDefinition<TRequest, TResponse, TData>;

  public constructor(
    definition: MiddlewareDefinition<TRequest, TResponse, TData>,
  ) {
    this.definition = definition;
  }

  public getRequestSchema(): TRequest | undefined {
    return this.definition.request;
  }

  public getResponseSchema(): TResponse | undefined {
    return this.definition.response;
  }

  public async execute(
    context: HandlerContext<TRequest, TResponse>,
  ): Promise<MiddlewareResult<TData>> {
    return this.definition.handler(context);
  }

  public static isResponse(result: MiddlewareResult<any>): result is Response {
    return result instanceof Response;
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
