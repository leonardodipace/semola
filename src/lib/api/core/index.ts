import { err, ok } from "../../errors/index.js";
import type { Middleware } from "../middleware/index.js";
import { generateOpenApiSpec } from "../openapi/index.js";
import {
  type BodyCache,
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
} from "../validation/index.js";
import type {
  ApiOptions,
  Context,
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
  ValidatedRequest,
} from "./types.js";

// Shared defaults reused across requests to avoid per-request allocations
const defaultValidated: ValidatedRequest = {
  body: true,
  query: true,
  headers: true,
  cookies: true,
  params: true,
};

const jsonResponse = (status: number, data: unknown) =>
  Response.json(data, { status });

const textResponse = (status: number, text: string) =>
  new Response(text, { status });

const htmlResponse = (status: number, html: string) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });

const redirectResponse = (status: number, url: string) =>
  Response.redirect(url, status);

const noopGet = () => undefined;

const stripTrailingSlash = (path: string) => {
  if (path !== "/" && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
};

export class Api<TMiddlewares extends readonly Middleware[] = readonly []> {
  private options: ApiOptions<TMiddlewares>;
  private routes: RouteConfig<
    RequestSchema,
    ResponseSchema,
    TMiddlewares,
    readonly Middleware[]
  >[] = [];

  public constructor(options: ApiOptions<TMiddlewares> = {}) {
    this.options = options;
  }

  private getFullPath(path: string) {
    const prefix = this.options.prefix ?? "";
    const fullPath = stripTrailingSlash(prefix) + stripTrailingSlash(path);

    return fullPath || "/";
  }

  private hasSchemas(schema?: RequestSchema) {
    return (
      schema &&
      (schema.body ||
        schema.query ||
        schema.headers ||
        schema.cookies ||
        schema.params)
    );
  }

  private async validateRequest(
    req: Bun.BunRequest,
    bodyCache: BodyCache,
    schema?: RequestSchema,
  ) {
    let body: unknown = true;
    let query: unknown = true;
    let headers: unknown = true;
    let cookies: unknown = true;
    let params: unknown = true;

    if (schema?.body) {
      const [bodyErr, bodyVal] = await validateBody(
        req,
        schema.body,
        bodyCache,
      );

      if (bodyErr) {
        return err(bodyErr.type, bodyErr.message);
      }

      body = bodyVal;
    }

    if (schema?.query) {
      const [queryErr, queryVal] = await validateQuery(req, schema.query);

      if (queryErr) {
        return err(queryErr.type, queryErr.message);
      }

      query = queryVal;
    }

    if (schema?.headers) {
      const [headersErr, headersVal] = await validateHeaders(
        req,
        schema.headers,
      );

      if (headersErr) {
        return err(headersErr.type, headersErr.message);
      }

      headers = headersVal;
    }

    if (schema?.cookies) {
      const [cookiesErr, cookiesVal] = await validateCookies(
        req,
        schema.cookies,
      );

      if (cookiesErr) {
        return err(cookiesErr.type, cookiesErr.message);
      }

      cookies = cookiesVal;
    }

    if (schema?.params) {
      const [paramsErr, paramsVal] = await validateParams(req, schema.params);

      if (paramsErr) {
        return err(paramsErr.type, paramsErr.message);
      }

      params = paramsVal;
    }

    return ok({ body, query, headers, cookies, params });
  }

  private createContext<
    TReq extends RequestSchema,
    TRes extends ResponseSchema,
    TExt extends Record<string, unknown> = Record<string, unknown>,
  >(
    request: Request,
    validated: ValidatedRequest,
    extensions: Record<string, unknown>,
  ) {
    const ctx: Context<TReq, TRes, TExt> = {
      raw: request,
      req: validated as Context<TReq, TRes, TExt>["req"],
      json: jsonResponse as Context<TReq, TRes, TExt>["json"],
      text: textResponse,
      html: htmlResponse,
      redirect: redirectResponse,
      get: <K extends keyof TExt>(key: K) =>
        extensions[key as string] as TExt[K],
    };

    return ctx;
  }

  private buildBunRoutes() {
    const bunRoutes: MethodRoutes = {};

    for (const route of this.routes) {
      const { path, method, handler, request, middlewares } = route;

      const fullPath = this.getFullPath(path);

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      const allMiddlewares = [
        ...(this.options.middlewares ?? []),
        ...(middlewares ?? []),
      ];

      const hasMiddlewares = allMiddlewares.length > 0;
      const hasRouteSchemas = this.hasSchemas(request);

      if (!hasMiddlewares && !hasRouteSchemas) {
        bunRoutes[fullPath][method] = (req: Bun.BunRequest) => {
          return handler({
            raw: req,
            req: defaultValidated,
            json: jsonResponse,
            text: textResponse,
            html: htmlResponse,
            redirect: redirectResponse,
            get: noopGet,
          } as Parameters<typeof handler>[0]);
        };
      } else {
        bunRoutes[fullPath][method] = async (req: Bun.BunRequest) => {
          const bodyCache: BodyCache = { parsed: false, value: undefined };
          const extensions: Record<string, unknown> = {};

          for (const mw of allMiddlewares) {
            const { request: reqSchema, handler: mwHandler } = mw.options;

            let validated = defaultValidated;

            if (this.hasSchemas(reqSchema)) {
              const [error, v] = await this.validateRequest(
                req,
                bodyCache,
                reqSchema,
              );

              if (error) {
                return Response.json(
                  { message: error.message },
                  { status: 400 },
                );
              }

              validated = v;
            }

            const result = await mwHandler({
              raw: req,
              req: validated,
              json: jsonResponse,
              text: textResponse,
              html: htmlResponse,
              redirect: redirectResponse,
              get: noopGet,
            });

            if (result instanceof Response) {
              return result;
            }

            if (result) {
              Object.assign(extensions, result);
            }
          }

          let routeValidated = defaultValidated;

          if (hasRouteSchemas) {
            const [routeError, v] = await this.validateRequest(
              req,
              bodyCache,
              request,
            );

            if (routeError) {
              return Response.json(
                { message: routeError.message },
                { status: 400 },
              );
            }

            routeValidated = v;
          }

          const ctx = this.createContext(
            req,
            routeValidated,
            extensions,
          ) as Parameters<typeof handler>[0];

          return handler(ctx);
        };
      }
    }

    return bunRoutes;
  }

  public defineRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TRouteMiddlewares extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TMiddlewares, TRouteMiddlewares>) {
    this.routes.push(
      config as RouteConfig<
        RequestSchema,
        ResponseSchema,
        TMiddlewares,
        readonly Middleware[]
      >,
    );
  }

  public getOpenApiSpec() {
    return generateOpenApiSpec({
      title: this.options.openapi?.title ?? "API",
      description: this.options.openapi?.description,
      version: this.options.openapi?.version ?? "1.0.0",
      prefix: this.options.prefix,
      servers: this.options.openapi?.servers,
      securitySchemes: this.options.openapi?.securitySchemes,
      routes: this.routes,
      globalMiddlewares: this.options.middlewares,
    });
  }

  public serve(port: number, callback?: (server: Bun.Server<unknown>) => void) {
    const bunRoutes = this.buildBunRoutes();

    const server = Bun.serve({
      port,
      routes: bunRoutes,
      fetch: () => new Response("Not found", { status: 404 }),
    });

    if (callback) {
      callback(server);
    }
  }
}
