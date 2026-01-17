import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ResponseSchema = {
  [status: number]: StandardSchemaV1;
};

export type InferOutput<T extends StandardSchemaV1 | undefined> =
  T extends StandardSchemaV1
    ? NonNullable<T["~standard"]["types"]>["output"]
    : undefined;

export type ExtractStatusCodes<T extends ResponseSchema> = keyof T & number;

export type Api2Options = {
  prefix?: string;
  openapi?: OpenApiOptions;
};

export type OpenApiOptions = {
  version: string;
  title: string;
  description: string;
};

type HTTPMethod = Bun.Serve.HTTPMethod;
type BunHandler = Bun.Serve.Handler<Request, Bun.Server<unknown>, Response>;

export type Context<TResponse extends ResponseSchema = ResponseSchema> = {
  raw: Request;
  json: <S extends ExtractStatusCodes<TResponse>>(
    status: S,
    data: InferOutput<TResponse[S]>,
  ) => Response;
  text: (status: number, text: string) => Response;
};

export type RouteHandler<TResponse extends ResponseSchema = ResponseSchema> = (
  c: Context<TResponse>,
) => Response | Promise<Response>;

export type MethodRoutes = Record<string, Partial<Record<HTTPMethod, BunHandler>>>;

export type RouteConfig<TResponse extends ResponseSchema = ResponseSchema> = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request: unknown;
  response: TResponse;
  handler: RouteHandler<TResponse>;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
