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
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
  ValidatedRequest,
} from "./types.js";

// Shared defaults reused across requests to avoid per-request allocations
const defaultValidated: ValidatedRequest = Object.freeze({
  body: undefined,
  query: undefined,
  headers: undefined,
  cookies: undefined,
  params: undefined,
});

const responseHelpers = {
  json: (status: number, data: unknown) => Response.json(data, { status }),
  text: (status: number, text: string) => new Response(text, { status }),
  html: (status: number, html: string) =>
    new Response(html, { status, headers: { "Content-Type": "text/html" } }),
  redirect: (status: number, url: string) => Response.redirect(url, status),
} as const;

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
    if (!this.options.prefix) {
      return stripTrailingSlash(path) || "/";
    }

    const normalizedPrefix = stripTrailingSlash(this.options.prefix);
    const normalizedPath = stripTrailingSlash(path);

    // Avoid double slashes when prefix ends at root
    if (normalizedPath.startsWith("/")) {
      return normalizedPrefix + normalizedPath;
    }

    return `${normalizedPrefix}/${normalizedPath}`;
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
    const validated: Record<string, unknown> = {};

    const validators = {
      body: (s: typeof schema) => validateBody(req, s?.body, bodyCache),
      query: (s: typeof schema) => validateQuery(req, s?.query),
      headers: (s: typeof schema) => validateHeaders(req, s?.headers),
      cookies: (s: typeof schema) => validateCookies(req, s?.cookies),
      params: (s: typeof schema) => validateParams(req, s?.params),
    };

    const fields = ["body", "query", "headers", "cookies", "params"] as const;

    for (const field of fields) {
      if (schema?.[field]) {
        const [fieldErr, fieldVal] = await validators[field](schema);

        if (fieldErr) {
          return err(fieldErr.type, fieldErr.message);
        }

        validated[field] = fieldVal;
      }
    }

    return ok(validated as ValidatedRequest);
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
            ...responseHelpers,
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
              ...responseHelpers,
              get: (key: string) => extensions[key],
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

          return handler({
            raw: req,
            req: routeValidated,
            ...responseHelpers,
            get: <K extends string>(key: K) => extensions[key],
          } as Parameters<typeof handler>[0]);
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
