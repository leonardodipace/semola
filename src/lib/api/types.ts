import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Middleware } from "./middleware.js";

export type HTTPMethod = Bun.Serve.HTTPMethod;

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

export type StandardSchemaValidationResult = Awaited<
  ReturnType<StandardSchemaV1["~standard"]["validate"]>
>;

type SafeTypeAccess<
  T,
  K extends "input" | "output",
> = T extends StandardSchemaV1
  ? T["~standard"] extends { types?: infer U }
    ? U extends Record<K, infer V>
      ? V
      : never
    : never
  : undefined;

export type InferOutput<T extends StandardSchemaV1 | undefined> =
  SafeTypeAccess<T, "output">;

export type InferInput<T extends StandardSchemaV1 | undefined> = SafeTypeAccess<
  T,
  "input"
>;

export type ExtractStatusCodes<T extends ResponseSchema> = keyof T & number;

export type ExtractStatusCodesOrAny<T extends ResponseSchema | undefined> =
  T extends ResponseSchema ? ExtractStatusCodes<T> : number;

export type ValidationOptions =
  | boolean
  | {
      input?: boolean;
      output?: boolean;
    };

export type ApiOptions<
  TMiddlewares extends readonly Middleware[] = readonly [],
> = {
  prefix?: string;
  openapi?: OpenApiOptions;
  middlewares?: TMiddlewares;
  validation?: ValidationOptions;
};

export type GroupOptions<
  TMiddlewares extends readonly Middleware[] = readonly [],
> = {
  prefix?: string;
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

export type ApiRequest = Request & {
  params?: Record<string, string>;
};

export type Context<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema | undefined = undefined,
  TExt extends Record<string, unknown> = Record<string, unknown>,
> = {
  raw: Request;
  req: {
    body: InferOutput<TReq["body"]>;
    query: InferOutput<TReq["query"]>;
    headers: InferOutput<TReq["headers"]>;
    cookies: InferOutput<TReq["cookies"]>;
    params: InferOutput<TReq["params"]>;
  };
  json: <S extends ExtractStatusCodesOrAny<TRes>>(
    status: S,
    data: TRes extends ResponseSchema ? InferOutput<TRes[S]> : unknown,
  ) => Response;
  text: (status: number, text: string) => Response;
  html: (status: number, html: string) => Response;
  redirect: (status: number, url: string) => Response;
  get: <K extends keyof TExt>(key: K) => TExt[K];
};

export type RouteReturn =
  | Response
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];

export type RouteHandler<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema | undefined = undefined,
  TExt extends Record<string, unknown> = Record<string, unknown>,
> = (c: Context<TReq, TRes, TExt>) => Response | Promise<Response>;

export type BareRouteHandler = () => RouteReturn | Promise<RouteReturn>;

export type ValidatedRequest = {
  body?: unknown;
  query?: unknown;
  headers?: unknown;
  cookies?: unknown;
  params?: unknown;
};

export type MethodRoutes = Record<
  string,
  Partial<Record<HTTPMethod, BunHandler>>
>;

export type RouteConfig<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema | undefined = undefined,
  TGlobalMiddlewares extends readonly Middleware[] = readonly [],
  TRouteMiddlewares extends readonly Middleware[] = readonly [],
> = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request?: TReq;
  response?: TRes;
  middlewares?: TRouteMiddlewares;
  handler:
    | RouteHandler<
        TReq,
        TRes,
        MergeMiddlewareExtensions<TGlobalMiddlewares> &
          MergeMiddlewareExtensions<TRouteMiddlewares>
      >
    | BareRouteHandler;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};

export type ResolvedValidation = {
  input: boolean;
  output: boolean;
};

export type MiddlewareHandler<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema | undefined = undefined,
  TExt extends Record<string, unknown> = Record<never, never>,
> = (
  c: Context<TReq, TRes>,
) =>
  | Response
  | TExt
  | undefined
  | Promise<Response | TExt | undefined>
  | Promise<void>
  | void;

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
  options: MiddlewareOptions<infer _TReq, infer _TRes, infer E>;
}
  ? E
  : never;

export type MergeMiddlewareExtensions<T extends readonly unknown[]> =
  T extends readonly [infer First, ...infer Rest]
    ? InferMiddlewareExtension<First> & MergeMiddlewareExtensions<Rest>
    : {};

export type BodyCache = {
  parsed: boolean;
  value: unknown;
};

export type RequestValidator = (
  req: Bun.BunRequest,
  bodyCache?: BodyCache,
) => Promise<Error | undefined>;

export type ValidateRequestInput = {
  req: Bun.BunRequest;
  schema?: RequestSchema;
  bodyCache?: BodyCache;
};

export type InternalContext = {
  raw: Bun.BunRequest;
  req: ValidatedRequest;
  get: (key: string) => unknown;
  json: (status: number, data: unknown) => Response;
  text: (status: number, text: string) => Response;
  html: (status: number, html: string) => Response;
  redirect: (status: number, url: string) => Response;
};

export type BunRouteHandler = (
  req: Bun.BunRequest,
) => Response | Promise<Response>;

export type AnyRouteHandler = (
  context: InternalContext,
) => Response | Promise<Response>;

export type HandleRequestConfig = {
  middlewares: readonly Middleware[];
  routeRequest?: RequestSchema;
  routeResponse?: ResponseSchema;
  validateInput: boolean;
  validateOutput: boolean;
  handler: AnyRouteHandler;
};

export type RouteMethods = Partial<Record<HTTPMethod, BunRouteHandler>>;

export type CompiledSegment = {
  value: string;
  paramName?: string;
};

export type DynamicRoute = {
  segments: CompiledSegment[];
  methods: RouteMethods;
  paramStarts: number[];
  paramEnds: number[];
};

export type PatternRoute = {
  pattern: URLPattern;
  methods: RouteMethods;
};

export type OpenApiSpec = {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenApiPath>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

export type OpenApiPath = {
  [method: string]: OpenApiOperation;
};

export type OpenApiOperation = {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
};

export type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema: unknown;
};

export type OpenApiRequestBody = {
  required?: boolean;
  content: {
    [mediaType: string]: {
      schema: unknown;
    };
  };
};

export type OpenApiResponse = {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: unknown;
    };
  };
};

export type OpenApiComponents = NonNullable<OpenApiSpec["components"]>;

export type RouteConfigInternal = {
  path: string;
  method: string;
  request?: RequestSchema;
  response?: ResponseSchema;
  middlewares?: readonly Middleware[];
  handler: unknown;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};

export type OpenApiGeneratorOptions = {
  title: string;
  description?: string;
  version: string;
  prefix?: string;
  servers?: Array<{ url: string; description?: string }>;
  securitySchemes?: Record<string, unknown>;
  routes: RouteConfigInternal[];
  globalMiddlewares?: readonly Middleware[];
};

export type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};
