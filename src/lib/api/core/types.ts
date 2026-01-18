import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Middleware } from "../middleware/index.js";
import type { MergeMiddlewareExtensions } from "../middleware/types.js";

type HTTPMethod = Bun.Serve.HTTPMethod;

type BunHandler = Bun.Serve.Handler<Request, Bun.Server<unknown>, Response>;

export type ResponseSchema = {
  [status: number]: StandardSchemaV1;
};

export type RequestSchema = {
  body?: StandardSchemaV1;
  query?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  cookies?: StandardSchemaV1;
};

export type InferOutput<T extends StandardSchemaV1 | undefined> =
  T extends StandardSchemaV1
    ? NonNullable<T["~standard"]["types"]>["output"]
    : undefined;

export type InferInput<T extends StandardSchemaV1 | undefined> =
  T extends StandardSchemaV1
    ? NonNullable<T["~standard"]["types"]>["input"]
    : undefined;

export type ExtractStatusCodes<T extends ResponseSchema> = keyof T & number;

export type ApiOptions = {
  prefix?: string;
  openapi?: OpenApiOptions;
  middlewares?: Middleware[];
};

export type OpenApiOptions = {
  version: string;
  title: string;
  description: string;
};

export type Context<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
  TExt extends Record<string, unknown> = Record<string, unknown>,
> = {
  raw: Request;
  req: {
    body: InferInput<TReq["body"]>;
    query: InferInput<TReq["query"]>;
    headers: InferInput<TReq["headers"]>;
    cookies: InferInput<TReq["cookies"]>;
  };
  json: <S extends ExtractStatusCodes<TRes>>(
    status: S,
    data: InferOutput<TRes[S]>,
  ) => Response;
  text: (status: number, text: string) => Response;
  get: <K extends keyof TExt>(key: K) => TExt[K];
};

export type RouteHandler<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
  TExt extends Record<string, unknown> = Record<string, unknown>,
> = (c: Context<TReq, TRes, TExt>) => Response | Promise<Response>;

export type MethodRoutes = Record<
  string,
  Partial<Record<HTTPMethod, BunHandler>>
>;

export type RouteConfig<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
  TMiddlewares extends readonly Middleware[] = readonly [],
> = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request?: TReq;
  response: TRes;
  middlewares?: TMiddlewares;
  handler: RouteHandler<TReq, TRes, MergeMiddlewareExtensions<TMiddlewares>>;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
