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

export type Context = {
  raw: Request;
  json: (status: number, data: unknown) => Response;
  text: (status: number, text: string) => Response;
};

export type RouteHandler = (c: Context) => Response | Promise<Response>;

export type MethodRoutes = Record<string, Partial<Record<HTTPMethod, BunHandler>>>;

export type RouteConfig = {
  path: string;
  method: Bun.Serve.HTTPMethod;
  request: unknown;
  response: unknown;
  handler: RouteHandler;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
};
