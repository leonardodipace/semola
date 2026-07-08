import { buildFetchDispatcher } from "./dispatch.js";
import { Group } from "./group.js";
import type { Middleware } from "./middleware.js";
import { generateOpenApiSpec } from "./openapi/index.js";
import {
  bodyHasMultipleReaders,
  createContext,
  emptyValidated,
  getFullPath,
  mapValidationError,
  resolveValidation,
  validatingJson,
} from "./runtime.js";
import type {
  AnyRouteHandler,
  ApiOptions,
  BareRouteHandler,
  BodyCache,
  BunRouteHandler,
  HandleRequestConfig,
  MethodRoutes,
  RequestSchema,
  ResolvedValidation,
  ResponseSchema,
  RouteConfig,
  RouteReturn,
} from "./types.js";
import {
  buildRequestValidator,
  compileBodyValidator,
  isBodyOnlySchema,
  validateParts,
  validateSchema,
} from "./validate.js";

const emptyMiddlewares: readonly Middleware[] = [];

const toResponse = (value: RouteReturn): Response => {
  if (value instanceof Response) return value;

  if (typeof value === "string") return new Response(value);

  return Response.json(value);
};

const validateResponse = async (
  value: RouteReturn,
  responseSchema?: ResponseSchema,
) => {
  const response = toResponse(value);
  const schema = responseSchema?.[response.status];

  if (!schema) return response;

  let data: unknown = value;

  if (value instanceof Response) {
    data = await response.clone().json();
  }

  try {
    validateSchema(schema, data);
  } catch (error) {
    return mapValidationError(error as Error);
  }

  return response;
};

const prepareResponse = (
  value: RouteReturn,
  responseSchema?: ResponseSchema,
): Response | Promise<Response> => {
  if (value instanceof Response) {
    return validateResponse(value, responseSchema);
  }

  const response = toResponse(value);
  const schema = responseSchema?.[response.status];

  if (!schema) return response;

  try {
    validateSchema(schema, value);
  } catch (error) {
    return mapValidationError(error as Error);
  }

  return response;
};

const buildBareRoute = (
  handler: BareRouteHandler,
  request?: RequestSchema,
  response?: ResponseSchema,
  validateInput = false,
  validateOutput = false,
): BunRouteHandler => {
  const responseSchema = validateOutput ? response : undefined;
  let bodyValidator: ReturnType<typeof compileBodyValidator> | undefined;

  if (validateInput && request && isBodyOnlySchema(request)) {
    const bodySchema = request.body;

    if (bodySchema) {
      bodyValidator = compileBodyValidator(bodySchema);
    }
  }

  const validateRequest =
    validateInput && !bodyValidator
      ? buildRequestValidator(request)
      : undefined;
  const probe = handler();

  if (probe instanceof Promise) {
    return async (req) => {
      if (bodyValidator) {
        try {
          await bodyValidator(req);
        } catch (error) {
          return mapValidationError(error as Error);
        }
      }

      if (validateRequest) {
        const error = await validateRequest(req);

        if (error) return mapValidationError(error);
      }

      const value = await handler();

      return validateResponse(value, responseSchema);
    };
  }

  const cached = prepareResponse(probe, responseSchema);

  if (!bodyValidator && !validateRequest) {
    if (cached instanceof Promise) return async () => cached;

    return () => cached;
  }

  if (bodyValidator) {
    return async (req) => {
      try {
        await bodyValidator(req);
      } catch (error) {
        return mapValidationError(error as Error);
      }

      return cached;
    };
  }

  const validator = validateRequest;

  if (!validator) {
    if (cached instanceof Promise) return async () => cached;

    return () => cached;
  }

  return async (req) => {
    const error = await validator(req);

    if (error) return mapValidationError(error);

    return cached;
  };
};

const buildContextRoute = (handler: AnyRouteHandler): BunRouteHandler => {
  return (req) => {
    const result = handler(createContext(req));

    if (result instanceof Promise) {
      return result.then((value) => {
        if (value instanceof Response) return value;

        return toResponse(value);
      });
    }

    if (result instanceof Response) return result;

    return toResponse(result);
  };
};

const getRouteMiddlewares = (
  route: RouteConfig<
    RequestSchema,
    ResponseSchema,
    readonly Middleware[],
    readonly Middleware[]
  >,
  globalMiddlewares: readonly Middleware[],
) => {
  if (!route.middlewares?.length) return globalMiddlewares;

  if (globalMiddlewares.length === 0) return route.middlewares;

  return [...globalMiddlewares, ...route.middlewares];
};

const routeValidatesInput = (
  validation: ResolvedValidation,
  request: RequestSchema | undefined,
  middlewares: readonly Middleware[],
) => {
  if (!validation.input) return false;

  if (request) return true;

  for (const middleware of middlewares) {
    if (middleware.options.request) return true;
  }

  return false;
};

const handleRequest = async (
  req: Bun.BunRequest,
  config: HandleRequestConfig,
) => {
  let extensions: Record<string, unknown> | undefined;
  let get: ((key: string) => unknown) | undefined;
  let bodyCache: BodyCache | undefined;

  if (
    config.validateInput &&
    bodyHasMultipleReaders({
      middlewares: config.middlewares,
      request: config.routeRequest,
    })
  ) {
    bodyCache = { parsed: false, value: undefined };
  }

  let jsonHandler: ((status: number, data: unknown) => Response) | undefined;

  if (config.validateOutput && config.routeResponse) {
    jsonHandler = validatingJson(config.routeResponse);
  }

  if (config.middlewares.length > 0) {
    get = (key: string) => {
      return extensions?.[key];
    };
  }

  for (const middleware of config.middlewares) {
    const { request: requestSchema, handler: middlewareHandler } =
      middleware.options;

    let validated = emptyValidated;

    if (config.validateInput && requestSchema) {
      const data = {};
      const error = await validateParts(
        { req, schema: requestSchema, bodyCache },
        data,
      );

      if (error) return mapValidationError(error);

      validated = data;
    }

    const context = createContext(req, validated, get);
    const middlewareResult = await middlewareHandler(
      context as Parameters<typeof middlewareHandler>[0],
    );

    if (middlewareResult instanceof Response) return middlewareResult;

    if (middlewareResult) {
      if (!extensions) {
        extensions = {};
      }

      Object.assign(extensions, middlewareResult);
    }
  }

  let validated = emptyValidated;

  if (config.validateInput && config.routeRequest) {
    const data = {};
    const error = await validateParts(
      { req, schema: config.routeRequest, bodyCache },
      data,
    );

    if (error) return mapValidationError(error);

    validated = data;
  }

  const context = createContext(req, validated, get, jsonHandler);

  return config.handler(context);
};

const buildHandler = (
  route: RouteConfig<
    RequestSchema,
    ResponseSchema,
    readonly Middleware[],
    readonly Middleware[]
  >,
  globalMiddlewares: readonly Middleware[],
  validation: ResolvedValidation,
): BunRouteHandler => {
  const middlewares = getRouteMiddlewares(route, globalMiddlewares);
  const handler = route.handler;

  const hasMiddleware = middlewares.length > 0;
  const validateInput = routeValidatesInput(
    validation,
    route.request,
    middlewares,
  );
  const validateOutput = validation.output && !!route.response;

  if (!hasMiddleware && typeof handler === "function" && handler.length === 0) {
    return buildBareRoute(
      handler as BareRouteHandler,
      route.request,
      route.response,
      validateInput,
      validateOutput,
    );
  }

  if (
    !hasMiddleware &&
    typeof handler === "function" &&
    handler.length === 1 &&
    !validateInput &&
    !validateOutput
  ) {
    return buildContextRoute(handler as AnyRouteHandler);
  }

  const config: HandleRequestConfig = {
    middlewares,
    routeRequest: route.request,
    routeResponse: route.response,
    validateInput,
    validateOutput,
    handler: handler as AnyRouteHandler,
  };

  return (req) => handleRequest(req, config);
};

const compileRoutes = (
  routes: RouteConfig<
    RequestSchema,
    ResponseSchema,
    readonly Middleware[],
    readonly Middleware[]
  >[],
  prefix: string | undefined,
  globalMiddlewares: readonly Middleware[],
  validation: ResolvedValidation,
): MethodRoutes => {
  const bunRoutes: MethodRoutes = {};

  for (const route of routes) {
    const fullPath = getFullPath({ prefix, path: route.path });

    if (!bunRoutes[fullPath]) {
      bunRoutes[fullPath] = {};
    }

    bunRoutes[fullPath][route.method] = buildHandler(
      route,
      globalMiddlewares,
      validation,
    );
  }

  return bunRoutes;
};

export class Api<
  TMiddlewares extends readonly Middleware[] = readonly [],
> extends Group<TMiddlewares> {
  protected override options: ApiOptions<TMiddlewares>;
  private compiled?: {
    routes: MethodRoutes;
    fetch: (req: Request) => Response | Promise<Response>;
  };
  private needsRecompile = true;

  public constructor(options: ApiOptions<TMiddlewares> = {}) {
    super(options);
    this.options = options;
  }

  public override defineRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TRouteMiddlewares extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TMiddlewares, TRouteMiddlewares>) {
    super.defineRoute(config);
    this.needsRecompile = true;
  }

  public override mount(group: Group<readonly Middleware[]>) {
    super.mount(group);
    this.needsRecompile = true;
  }

  public fetch = (req: Request) => {
    return this.ensureCompiled().fetch(req);
  };

  public getRouteHandlers() {
    return this.ensureCompiled().routes;
  }

  public getOpenApiSpec() {
    const routes = this.collectRoutes(undefined, emptyMiddlewares);

    return generateOpenApiSpec({
      title: this.options.openapi?.title ?? "API",
      description: this.options.openapi?.description,
      version: this.options.openapi?.version ?? "1.0.0",
      servers: this.options.openapi?.servers,
      securitySchemes: this.options.openapi?.securitySchemes,
      routes,
    });
  }

  public serve(port: number, callback?: (server: Bun.Server<unknown>) => void) {
    const server = Bun.serve({
      port,
      routes: this.getRouteHandlers(),
      fetch: () => new Response("Not found", { status: 404 }),
    });

    if (callback) {
      callback(server);
    }
  }

  private ensureCompiled() {
    if (!this.needsRecompile && this.compiled) return this.compiled;

    const routesList = this.collectRoutes(undefined, emptyMiddlewares);
    const routes = compileRoutes(
      routesList,
      undefined,
      emptyMiddlewares,
      resolveValidation(this.options.validation),
    );

    this.compiled = {
      routes,
      fetch: buildFetchDispatcher(routes),
    };

    this.needsRecompile = false;

    return this.compiled;
  }
}
