import type { Context, RequestSchema, ResponseSchema } from "../core/types.js";

export type MiddlewareHandler<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema | undefined = undefined,
  TExt extends Record<string, unknown> = Record<string, unknown>,
> = (
  c: Context<TReq, TRes>,
) => Response | TExt | Promise<Response | TExt> | Promise<void>;

export type MiddlewareOptions<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema | undefined = undefined,
  TExt extends Record<string, unknown> = Record<string, unknown>,
> = {
  request?: TReq;
  response?: TRes;
  handler: MiddlewareHandler<TReq, TRes, TExt>;
};

export type InferMiddlewareExtension<T> = T extends {
  options: MiddlewareOptions<RequestSchema, ResponseSchema, infer E>;
}
  ? E
  : never;

export type MergeMiddlewareExtensions<T extends readonly unknown[]> =
  T extends readonly [infer First, ...infer Rest]
    ? InferMiddlewareExtension<First> & MergeMiddlewareExtensions<Rest>
    : {};
