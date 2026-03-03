import { mightThrow } from "../../errors/index.js";
import type { Middleware } from "../middleware/index.js";
import { generateOpenApiSpec } from "../openapi/index.js";
import {
  type BodyCache,
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
  validateSchema,
} from "../validation/index.js";
import type {
  ApiOptions,
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
  ValidatedRequest,
  ValidationOptions,
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

const resolveValidation = (v?: ValidationOptions) => {
  if (v === undefined || v === true) return { input: true, output: true };
  if (v === false) return { input: false, output: false };
  return { input: v.input !== false, output: v.output !== false };
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
    const normalizedPath = stripTrailingSlash(path) || "/";

    if (!this.options.prefix) return normalizedPath;

    const normalizedPrefix = stripTrailingSlash(this.options.prefix);

    if (normalizedPrefix === "/") return normalizedPath;
    if (normalizedPath === "/") return normalizedPrefix;

    return normalizedPrefix + normalizedPath;
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

  private async validateResponseBody(
    response: Response,
    schema: ResponseSchema | undefined,
  ) {
    if (!schema) return response;

    const statusSchema = schema[response.status];

    if (!statusSchema) return response;

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) return response;

    const [parseError, body] = await mightThrow(response.clone().json());

    if (parseError) {
      return responseHelpers.json(400, { message: "Invalid response body" });
    }

    const [validationError] = await validateSchema(statusSchema, body);

    if (validationError) {
      return responseHelpers.json(400, { message: validationError.message });
    }

    return response;
  }

  private buildBunRoutes() {
    const bunRoutes: MethodRoutes = {};
    const validationConfig = resolveValidation(this.options.validation);

    for (const route of this.routes) {
      const { path, method, handler, request, response, middlewares } = route;

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
      const effectiveOutputValidation = validationConfig.output && !!response;

      if (
        !hasMiddlewares &&
        !(validationConfig.input && hasRouteSchemas) &&
        !effectiveOutputValidation
      ) {
        // Zero-allocation path for simple routes using prototype chain
        // Avoids object spread overhead by inheriting response helpers via prototype
        bunRoutes[fullPath][method] = (req: Bun.BunRequest) => {
          // Create fresh per-request context to avoid cross-request contamination
          const context = Object.create(responseHelpers);
          context.raw = req;
          context.req = defaultValidated;
          context.get = noopGet;

          return handler(context as unknown as Parameters<typeof handler>[0]);
        };
      } else {
        bunRoutes[fullPath][method] = async (req: Bun.BunRequest) => {
          const extensions: Record<string, unknown> = {};

          // Only create bodyCache if input validation is enabled and any schema has body validation
          const bodyCache: BodyCache | undefined =
            validationConfig.input &&
            shouldCreateBodyCache(hasMiddlewares, allMiddlewares, request)
              ? { parsed: false, value: undefined }
              : undefined;

          for (const mw of allMiddlewares) {
            const { request: reqSchema, handler: mwHandler } = mw.options;

            let validated = defaultValidated;

            if (validationConfig.input && hasSchemas(reqSchema)) {
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

          if (validationConfig.input && hasRouteSchemas) {
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
          const handlerResponse = await handler(
            context as Parameters<typeof handler>[0],
          );

          if (effectiveOutputValidation) {
            return this.validateResponseBody(handlerResponse, response);
          }

          return handlerResponse;
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
