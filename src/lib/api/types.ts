import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { CommonError } from "../errors/types.js";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD";

export type ApiError = {
  type: CommonError;
  message: string;
  context?: {
    validationField?: string;
    statusCode: number;
  };
};

export type ApiOptions = {
  prefix?: string;
  openapi?: {
    title: string;
    description?: string;
    version: string;
  };
};

export type RequestSchema = {
  body?: StandardSchemaV1;
  params?: StandardSchemaV1;
  query?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  cookies?: StandardSchemaV1;
};

export type ResponseSchema = {
  [status: number]: StandardSchemaV1;
};

export type InferInput<T extends StandardSchemaV1 | undefined> =
  T extends StandardSchemaV1
    ? NonNullable<T["~standard"]["types"]>["input"]
    : undefined;

export type InferOutput<T extends StandardSchemaV1 | undefined> =
  T extends StandardSchemaV1
    ? NonNullable<T["~standard"]["types"]>["output"]
    : undefined;

export type ExtractStatusCodes<T extends ResponseSchema> = keyof T & number;

export type HandlerContext<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> = {
  request: {
    body: InferInput<TRequest["body"]>;
    params: InferInput<TRequest["params"]>;
    query: InferInput<TRequest["query"]>;
    headers: InferInput<TRequest["headers"]>;
    cookies: InferInput<TRequest["cookies"]>;
  };
  json: <S extends ExtractStatusCodes<TResponse>>(
    status: S,
    data: InferOutput<TResponse[S]>,
  ) => Promise<Response>;
  text: (status: number, text: string) => Response;
  html: (status: number, html: string) => Response;
  redirect: (status: number, url: string) => Response;
  raw: Request;
};

export type RouteHandler<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> = (
  context: HandlerContext<TRequest, TResponse>,
) => Promise<Response> | Response;

export type RouteDefinition<
  TRequest extends RequestSchema = RequestSchema,
  TResponse extends ResponseSchema = ResponseSchema,
> = {
  path: string;
  method: HttpMethod;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  request?: TRequest;
  response: TResponse;
  handler: RouteHandler<TRequest, TResponse>;
};

export type InternalRoute = {
  path: string;
  method: HttpMethod;
  handler: (req: Request) => Promise<Response>;
  definition: RouteDefinition;
};
