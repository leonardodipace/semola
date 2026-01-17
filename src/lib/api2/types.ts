import type { StandardSchemaV1 } from "@standard-schema/spec";

type HTTPMethod = Bun.Serve.HTTPMethod;

type BunHandler = Bun.Serve.Handler<Request, Bun.Server<unknown>, Response>;

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

export type Context<T extends ResponseSchema = ResponseSchema> = {
  raw: Request;
  json: <S extends ExtractStatusCodes<T>>(
    status: S,
    data: InferOutput<T[S]>,
  ) => Response;
  text: (status: number, text: string) => Response;
};

export type RouteHandler<T extends ResponseSchema = ResponseSchema> = (
  c: Context<T>,
) => Response | Promise<Response>;

export type MethodRoutes = Record<
  string,
  Partial<Record<HTTPMethod, BunHandler>>
>;

export type RouteConfig<T extends ResponseSchema = ResponseSchema> = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request: unknown;
  response: T;
  handler: RouteHandler<T>;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
