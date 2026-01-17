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
type Handler = Bun.Serve.Handler<Request, Bun.Server<unknown>, Response>;

export type MethodRoutes = Record<string, Partial<Record<HTTPMethod, Handler>>>;

export type RouteConfig = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request: unknown;
  response: unknown;
  handler: Handler;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
