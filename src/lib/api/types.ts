import type { StandardSchemaV1 } from "@standard-schema/spec";

type HTTPMethod = Bun.Serve.HTTPMethod;

type BunHandler = Bun.Serve.Handler<Request, Bun.Server<unknown>, Response>;

export type ResponseSchema = {
  [status: number]: StandardSchemaV1;
};

export type RequestSchema = {
  body?: StandardSchemaV1;
  query?: StandardSchemaV1;
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
};

export type OpenApiOptions = {
  version: string;
  title: string;
  description: string;
};

export type Context<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> = {
  raw: Request;
  req: {
    body: InferInput<TRequest["body"]>;
    query: InferInput<TRequest["query"]>;
  };
  json: <S extends ExtractStatusCodes<TResponse>>(
    status: S,
    data: InferOutput<TResponse[S]>,
  ) => Response;
  text: (status: number, text: string) => Response;
};

export type RouteHandler<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> = (c: Context<TRequest, TResponse>) => Response | Promise<Response>;

export type MethodRoutes = Record<
  string,
  Partial<Record<HTTPMethod, BunHandler>>
>;

export type RouteConfig<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request?: TRequest;
  response: TResponse;
  handler: RouteHandler<TRequest, TResponse>;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
