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

// Pre-create base context for simple routes to avoid per-request allocations
// Use prototype chain to inherit response helpers instead of spreading
const simpleContextBase: {
  raw?: Bun.BunRequest;
  req: ValidatedRequest;
  get: () => undefined;
} = Object.setPrototypeOf(
  {
    req: defaultValidated,
    get: noopGet,
  },
  responseHelpers,
);

const stripTrailingSlash = (path: string) => {
  if (path !== "/" && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
};

const hasSchemas = (schema?: RequestSchema) =>
  schema &&
  (schema.body ||
    schema.query ||
    schema.headers ||
    schema.cookies ||
    schema.params);

const needsBodyCache = (schema?: RequestSchema) => schema?.body !== undefined;

const shouldCreateBodyCache = (
  hasMiddlewares: boolean,
  allMiddlewares: Middleware[],
  request?: RequestSchema,
) => {
  if (needsBodyCache(request)) return true;
  if (!hasMiddlewares) return false;

  return allMiddlewares.some((mw) => needsBodyCache(mw.options.request));
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

  private async validateRequestSchema(
    req: Bun.BunRequest,
    schema: RequestSchema | undefined,
    bodyCache?: BodyCache,
  ) {
    if (!schema) {
      return { success: true, data: {} };
    }

    const v: Record<string, unknown> = {};

    if (schema.body) {
      const [err, val] = await validateBody(req, schema.body, bodyCache);

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.body = val;
    }

    if (schema.query) {
      const [err, val] = await validateQuery(req, schema.query);

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.query = val;
    }

    if (schema.headers) {
      const [err, val] = await validateHeaders(req, schema.headers);

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.headers = val;
    }

    if (schema.cookies) {
      const [err, val] = await validateCookies(req, schema.cookies);

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.cookies = val;
    }

    if (schema.params) {
      const [err, val] = await validateParams(req, schema.params);

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.params = val;
    }

    return { success: true, data: v };
  }

  private createContext(
    req: Bun.BunRequest,
    validated: ValidatedRequest,
    extensions: Record<string, unknown>,
  ) {
    return {
      raw: req,
      req: validated,
      ...responseHelpers,
      get: (key: string) => extensions[key],
    };
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
      const hasRouteSchemas = hasSchemas(request);

      if (!hasMiddlewares && !hasRouteSchemas) {
        // Zero-allocation path for simple routes using prototype chain
        // Avoids object spread overhead by inheriting response helpers via prototype
        bunRoutes[fullPath][method] = (req: Bun.BunRequest) => {
          simpleContextBase.raw = req;

          return handler(
            simpleContextBase as unknown as Parameters<typeof handler>[0],
          );
        };
      } else {
        bunRoutes[fullPath][method] = async (req: Bun.BunRequest) => {
          const extensions: Record<string, unknown> = {};

          // Only create bodyCache if any schema has body validation
          const bodyCache: BodyCache | undefined = shouldCreateBodyCache(
            hasMiddlewares,
            allMiddlewares,
            request,
          )
            ? { parsed: false, value: undefined }
            : undefined;

          for (const mw of allMiddlewares) {
            const { request: reqSchema, handler: mwHandler } = mw.options;

            let validated = defaultValidated;

            if (hasSchemas(reqSchema)) {
              const result = await this.validateRequestSchema(
                req,
                reqSchema,
                bodyCache,
              );

              if (!result.success) {
                return responseHelpers.json(400, {
                  message: result.error?.message,
                });
              }

              validated = result.data as ValidatedRequest;
            }

            const context = this.createContext(req, validated, extensions);
            const mwResult = await mwHandler(
              context as Parameters<typeof mwHandler>[0],
            );

            if (mwResult instanceof Response) {
              return mwResult;
            }

            if (mwResult) {
              Object.assign(extensions, mwResult);
            }
          }

          let routeValidated = defaultValidated;

          if (hasRouteSchemas) {
            const result = await this.validateRequestSchema(
              req,
              request,
              bodyCache,
            );

            if (!result.success) {
              return responseHelpers.json(400, {
                message: result.error?.message,
              });
            }

            routeValidated = result.data as ValidatedRequest;
          }

          const context = this.createContext(req, routeValidated, extensions);

          return handler(context as Parameters<typeof handler>[0]);
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
