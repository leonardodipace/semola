import type { StandardSchemaV1 } from "@standard-schema/spec";
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

const defaultValidated: ValidatedRequest = Object.freeze({
  body: undefined,
  query: undefined,
  headers: undefined,
  cookies: undefined,
  params: undefined,
});

const noopGet = () => undefined;

const jsonResponse = (status: number, data: unknown) =>
  status === 200 ? Response.json(data) : Response.json(data, { status });

const textResponse = (status: number, text: string) =>
  status === 200 ? new Response(text) : new Response(text, { status });

const badRequest = (message?: string) =>
  Response.json({ message }, { status: 400 });

const htmlResponse = (status: number, html: string) =>
  new Response(html, { status, headers: { "Content-Type": "text/html" } });

type ApiContext = {
  raw: Bun.BunRequest;
  req: ValidatedRequest;
  get: (key: string) => unknown;
  json: (status: number, data: unknown) => Response | Promise<Response>;
  text: (status: number, text: string) => Response;
  html: (status: number, html: string) => Response;
  redirect: (status: number, url: string) => Response;
};

const contextProto: Omit<ApiContext, "raw"> = {
  req: defaultValidated,
  get: noopGet,
  json: jsonResponse,
  text: textResponse,
  html: htmlResponse,
  redirect: (status: number, url: string) => Response.redirect(url, status),
};

const createContext = (req: Bun.BunRequest): ApiContext => {
  const context = Object.create(contextProto) as ApiContext;
  context.raw = req;

  return context;
};

const createBodyContext = (req: Bun.BunRequest, body: unknown): ApiContext => {
  const context = Object.create(contextProto) as ApiContext & ValidatedRequest;
  context.raw = req;
  context.body = body;
  context.req = context;

  return context;
};

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

const isBodyOnlySchema = (schema?: RequestSchema) =>
  !!schema?.body &&
  !schema.query &&
  !schema.headers &&
  !schema.cookies &&
  !schema.params;

const needsBodyCache = (schema?: RequestSchema) => schema?.body !== undefined;

const countBodyConsumers = (
  hasMiddlewares: boolean,
  allMiddlewares: Middleware[],
  request?: RequestSchema,
) => {
  let consumers = 0;

  if (needsBodyCache(request)) {
    consumers += 1;
  }

  if (!hasMiddlewares) {
    return consumers;
  }

  for (const mw of allMiddlewares) {
    if (needsBodyCache(mw.options.request)) {
      consumers += 1;
    }
  }

  return consumers;
};

const shouldCreateBodyCache = (
  hasMiddlewares: boolean,
  allMiddlewares: Middleware[],
  request?: RequestSchema,
) => countBodyConsumers(hasMiddlewares, allMiddlewares, request) > 1;

const resolveValidation = (v?: ValidationOptions) => {
  if (v === undefined || v === true) return { input: true, output: true };
  if (v === false) return { input: false, output: false };
  return { input: v.input !== false, output: v.output !== false };
};

const createJsonWithOutputValidation = (responseSchema: ResponseSchema) => {
  return (status: number, data: unknown): Response | Promise<Response> => {
    const statusSchema = responseSchema[status];

    if (!statusSchema) {
      return jsonResponse(status, data);
    }

    try {
      const validated = validateSchema(statusSchema, data);

      if (validated instanceof Promise) {
        return validated.then(
          () => jsonResponse(status, data),
          (error) =>
            badRequest(error instanceof Error ? error.message : undefined),
        );
      }

      return jsonResponse(status, data);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : undefined);
    }
  };
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
      const [err, val] = await mightThrow(
        validateBody(req, schema.body, bodyCache),
      );

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.body = val;
    }

    if (schema.query) {
      const [err, val] = await mightThrow(validateQuery(req, schema.query));

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.query = val;
    }

    if (schema.headers) {
      const [err, val] = await mightThrow(validateHeaders(req, schema.headers));

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.headers = val;
    }

    if (schema.cookies) {
      const [err, val] = await mightThrow(validateCookies(req, schema.cookies));

      if (err) {
        return {
          success: false,
          error: err,
        };
      }

      v.cookies = val;
    }

    if (schema.params) {
      const [err, val] = await mightThrow(validateParams(req, schema.params));

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
      const inputEnabled = validationConfig.input && hasRouteSchemas;

      if (!hasMiddlewares && !inputEnabled && !effectiveOutputValidation) {
        bunRoutes[fullPath][method] = (req: Bun.BunRequest) => {
          const context = createContext(req);

          return handler(context as Parameters<typeof handler>[0]);
        };
      } else if (
        !hasMiddlewares &&
        !inputEnabled &&
        effectiveOutputValidation
      ) {
        const responseSchema = response as ResponseSchema;

        bunRoutes[fullPath][method] = (req: Bun.BunRequest) => {
          const context = createContext(req);
          context.json = createJsonWithOutputValidation(responseSchema);

          return handler(context as Parameters<typeof handler>[0]);
        };
      } else if (
        !hasMiddlewares &&
        inputEnabled &&
        isBodyOnlySchema(request) &&
        !effectiveOutputValidation
      ) {
        const bodySchema = request?.body as StandardSchemaV1;

        bunRoutes[fullPath][method] = async (req: Bun.BunRequest) => {
          let body: unknown;

          try {
            body = await validateBody(req, bodySchema);
          } catch (error) {
            if (!(error instanceof Error)) {
              throw error;
            }

            return badRequest(error.message);
          }

          const context = createBodyContext(req, body);

          return handler(context as Parameters<typeof handler>[0]);
        };
      } else {
        bunRoutes[fullPath][method] = async (req: Bun.BunRequest) => {
          const extensions: Record<string, unknown> = {};

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
                return badRequest(result.error?.message);
              }

              validated = result.data as ValidatedRequest;
            }

            const context = createContext(req);
            context.req = validated;
            context.get = (key: string) => extensions[key];

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
              return badRequest(result.error?.message);
            }

            routeValidated = result.data as ValidatedRequest;
          }

          const context = createContext(req);
          context.req = routeValidated;
          context.get = (key: string) => extensions[key];

          if (effectiveOutputValidation) {
            context.json = createJsonWithOutputValidation(
              response as ResponseSchema,
            );
          }

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

  public getRouteHandlers() {
    return this.buildBunRoutes();
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
