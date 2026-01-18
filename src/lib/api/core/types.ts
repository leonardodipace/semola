import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Middleware } from "../middleware/index.js";
import type { MergeMiddlewareExtensions } from "../middleware/types.js";

type HTTPMethod = Bun.Serve.HTTPMethod;

type BunHandler = Bun.Serve.Handler<
  Bun.BunRequest,
  Bun.Server<unknown>,
  Response
>;

export type ResponseSchema = {
  [status: number]: StandardSchemaV1;
};

export type RequestSchema = {
  params?: StandardSchemaV1;
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

export type ApiOptions<
  TMiddlewares extends readonly Middleware[] = readonly [],
> = {
  prefix?: string;
  openapi?: OpenApiOptions;
  middlewares?: TMiddlewares;
};

export type SecuritySchemeApiKey = {
  type: "apiKey";
  name: string;
  in: "query" | "header" | "cookie";
  description?: string;
};

export type SecuritySchemeHttp = {
  type: "http";
  scheme: string;
  bearerFormat?: string;
  description?: string;
};

export type SecuritySchemeOAuth2Flow = {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
};

export type SecuritySchemeOAuth2 = {
  type: "oauth2";
  flows: {
    implicit?: SecuritySchemeOAuth2Flow;
    password?: SecuritySchemeOAuth2Flow;
    clientCredentials?: SecuritySchemeOAuth2Flow;
    authorizationCode?: SecuritySchemeOAuth2Flow;
  };
  description?: string;
};

export type SecuritySchemeOpenIdConnect = {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
};

export type SecurityScheme =
  | SecuritySchemeApiKey
  | SecuritySchemeHttp
  | SecuritySchemeOAuth2
  | SecuritySchemeOpenIdConnect;

export type OpenApiOptions = {
  version: string;
  title: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
  securitySchemes?: Record<string, SecurityScheme>;
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
    params: InferInput<TReq["params"]>;
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
  TGlobalMiddlewares extends readonly Middleware[] = readonly [],
  TRouteMiddlewares extends readonly Middleware[] = readonly [],
> = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request?: TReq;
  response: TRes;
  middlewares?: TRouteMiddlewares;
  handler: RouteHandler<
    TReq,
    TRes,
    MergeMiddlewareExtensions<TGlobalMiddlewares> &
      MergeMiddlewareExtensions<TRouteMiddlewares>
  >;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
