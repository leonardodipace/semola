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

const emptyValidated: ValidatedRequest = Object.freeze({
  body: undefined,
  query: undefined,
  headers: undefined,
  cookies: undefined,
  params: undefined,
});

const getNothing = () => undefined;

const json = (status: number, data: unknown) => {
  if (status === 200) {
    return Response.json(data);
  }

  return Response.json(data, { status });
};

const text = (status: number, body: string) => {
  if (status === 200) {
    return new Response(body);
  }

  return new Response(body, { status });
};

const html = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/html" } });

const redirect = (status: number, url: string) =>
  Response.redirect(url, status);

const badRequest = (message?: string) =>
  Response.json({ message }, { status: 400 });

type ApiContext = {
  raw: Bun.BunRequest;
  req: ValidatedRequest;
  get: (key: string) => unknown;
  json: (status: number, data: unknown) => Response | Promise<Response>;
  text: (status: number, text: string) => Response;
  html: (status: number, html: string) => Response;
  redirect: (status: number, url: string) => Response;
};

// Shared helpers and defaults live on the prototype so each request only sets raw.
const sharedContext = {
  req: emptyValidated,
  get: getNothing,
  json,
  text,
  html,
  redirect,
};

const createContext = (req: Bun.BunRequest): ApiContext => {
  const context = Object.create(sharedContext) as ApiContext;
  context.raw = req;

  return context;
};

const createContextWithBody = (
  req: Bun.BunRequest,
  body: unknown,
): ApiContext => {
  const context = Object.create(sharedContext) as ApiContext & ValidatedRequest;
  context.raw = req;
  context.body = body;
  // One allocation: context.req.body reads from the same object as context.body.
  context.req = context;

  return context;
};

const stripTrailingSlash = (path: string) => {
  if (path !== "/" && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
};

const hasRequestSchemas = (schema?: RequestSchema) =>
  schema &&
  (schema.body ||
    schema.query ||
    schema.headers ||
    schema.cookies ||
    schema.params);

const onlyValidatesBody = (schema?: RequestSchema) =>
  !!schema?.body &&
  !schema.query &&
  !schema.headers &&
  !schema.cookies &&
  !schema.params;

const validatesBody = (schema?: RequestSchema) => schema?.body !== undefined;

const bodyHasMultipleReaders = (
  middlewares: Middleware[],
  request?: RequestSchema,
) => {
  let readers = 0;

  if (validatesBody(request)) {
    readers += 1;
  }

  for (const middleware of middlewares) {
    if (validatesBody(middleware.options.request)) {
      readers += 1;
    }
  }

  return readers > 1;
};

const resolveValidation = (options?: ValidationOptions) => {
  if (options === undefined || options === true) {
    return { input: true, output: true };
  }

  if (options === false) {
    return { input: false, output: false };
  }

  return {
    input: options.input !== false,
    output: options.output !== false,
  };
};

const badRequestFromError = (error: Error) => badRequest(error.message);

const validatingJson = (responseSchema: ResponseSchema) => {
  return (status: number, data: unknown): Response | Promise<Response> => {
    const schema = responseSchema[status];

    if (!schema) {
      return json(status, data);
    }

    try {
      const result = validateSchema(schema, data);

      if (result instanceof Promise) {
        return result.then(
          () => json(status, data),
          (error) => badRequestFromError(error as Error),
        );
      }

      return json(status, data);
    } catch (error) {
      return badRequestFromError(error as Error);
    }
  };
};

type AnyRouteHandler = (context: ApiContext) => Response | Promise<Response>;

const runHandler = (handler: AnyRouteHandler, context: ApiContext) =>
  handler(context);

const wrapSimpleRoute = (handler: AnyRouteHandler) => {
  return (req: Bun.BunRequest) => runHandler(handler, createContext(req));
};

const wrapOutputValidatedRoute = (
  handler: AnyRouteHandler,
  responseSchema: ResponseSchema,
) => {
  return (req: Bun.BunRequest) => {
    const context = createContext(req);
    context.json = validatingJson(responseSchema);

    return runHandler(handler, context);
  };
};

const wrapBodyOnlyRoute = (
  handler: AnyRouteHandler,
  bodySchema: StandardSchemaV1,
) => {
  return async (req: Bun.BunRequest) => {
    let body: unknown;

    try {
      body = await validateBody(req, bodySchema);
    } catch (error) {
      return badRequestFromError(error as Error);
    }

    return runHandler(handler, createContextWithBody(req, body));
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

  private async validateField<T>(validate: () => Promise<T> | T) {
    let output = validate();

    if (!(output instanceof Promise)) {
      output = Promise.resolve(output);
    }

    const [error, value] = await mightThrow(output);

    if (error) {
      return { success: false as const, error };
    }

    return { success: true as const, value };
  }

  private async validateRequestSchema(
    req: Bun.BunRequest,
    schema: RequestSchema | undefined,
    bodyCache?: BodyCache,
  ) {
    if (!schema) {
      return { success: true as const, data: {} };
    }

    const data: Record<string, unknown> = {};

    if (schema.body) {
      const result = await this.validateField(() =>
        validateBody(req, schema.body, bodyCache),
      );

      if (!result.success) {
        return { success: false as const, error: result.error };
      }

      data.body = result.value;
    }

    if (schema.query) {
      const result = await this.validateField(() =>
        validateQuery(req, schema.query),
      );

      if (!result.success) {
        return { success: false as const, error: result.error };
      }

      data.query = result.value;
    }

    if (schema.headers) {
      const result = await this.validateField(() =>
        validateHeaders(req, schema.headers),
      );

      if (!result.success) {
        return { success: false as const, error: result.error };
      }

      data.headers = result.value;
    }

    if (schema.cookies) {
      const result = await this.validateField(() =>
        validateCookies(req, schema.cookies),
      );

      if (!result.success) {
        return { success: false as const, error: result.error };
      }

      data.cookies = result.value;
    }

    if (schema.params) {
      const result = await this.validateField(() =>
        validateParams(req, schema.params),
      );

      if (!result.success) {
        return { success: false as const, error: result.error };
      }

      data.params = result.value;
    }

    return { success: true as const, data };
  }

  private createRouteHandler(
    route: RouteConfig<
      RequestSchema,
      ResponseSchema,
      TMiddlewares,
      readonly Middleware[]
    >,
    validation: ReturnType<typeof resolveValidation>,
  ) {
    const { handler, request, response, middlewares } = route;

    const allMiddlewares = [
      ...(this.options.middlewares ?? []),
      ...(middlewares ?? []),
    ];

    const hasMiddlewares = allMiddlewares.length > 0;
    const validateInput = validation.input && hasRequestSchemas(request);
    const validateOutput = validation.output && !!response;
    const isSimpleRoute = !hasMiddlewares && !validateInput && !validateOutput;
    const isOutputOnlyRoute =
      !hasMiddlewares && !validateInput && validateOutput;
    const isBodyOnlyRoute =
      !hasMiddlewares &&
      validateInput &&
      onlyValidatesBody(request) &&
      !validateOutput;

    if (isSimpleRoute) {
      return wrapSimpleRoute(handler as AnyRouteHandler);
    }

    if (isOutputOnlyRoute) {
      return wrapOutputValidatedRoute(
        handler as AnyRouteHandler,
        response as ResponseSchema,
      );
    }

    if (isBodyOnlyRoute) {
      return wrapBodyOnlyRoute(
        handler as AnyRouteHandler,
        request?.body as StandardSchemaV1,
      );
    }

    return async (req: Bun.BunRequest) => {
      const extensions: Record<string, unknown> = {};

      let bodyCache: BodyCache | undefined;

      if (validation.input && bodyHasMultipleReaders(allMiddlewares, request)) {
        bodyCache = { parsed: false, value: undefined };
      }

      for (const middleware of allMiddlewares) {
        const { request: requestSchema, handler: middlewareHandler } =
          middleware.options;

        let validated = emptyValidated;

        if (validation.input && hasRequestSchemas(requestSchema)) {
          const result = await this.validateRequestSchema(
            req,
            requestSchema,
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

        const middlewareResult = await middlewareHandler(
          context as Parameters<typeof middlewareHandler>[0],
        );

        if (middlewareResult instanceof Response) {
          return middlewareResult;
        }

        if (middlewareResult) {
          Object.assign(extensions, middlewareResult);
        }
      }

      let validated = emptyValidated;

      if (validation.input && hasRequestSchemas(request)) {
        const result = await this.validateRequestSchema(
          req,
          request,
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

      if (validateOutput) {
        context.json = validatingJson(response as ResponseSchema);
      }

      return runHandler(handler as AnyRouteHandler, context);
    };
  }

  private buildBunRoutes() {
    const bunRoutes: MethodRoutes = {};
    const validation = resolveValidation(this.options.validation);

    for (const route of this.routes) {
      const fullPath = this.getFullPath(route.path);

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][route.method] = this.createRouteHandler(
        route,
        validation,
      );
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
