import { buildFetchDispatcher } from "./dispatch.js";
import { DuplicateRouteError } from "./errors.js";
import { Group } from "./group.js";
import type { Middleware } from "./middleware.js";
import { generateOpenApiSpec } from "./openapi/index.js";
import {
  applyHeaders,
  bodyHasMultipleReaders,
  checkOutput,
  createContext,
  emptyValidated,
  mapValidationError,
  resolveValidation,
  validatingJson,
} from "./runtime.js";
import { serveWithBun, serveWithNode } from "./serve.js";
import type {
  AnyRouteConfig,
  AnyRouteHandler,
  ApiOptions,
  ApiRequest,
  ApiServer,
  BareRouteHandler,
  BodyCache,
  CompiledApi,
  HandleRequestConfig,
  MethodRoutes,
  OnErrorOptions,
  RequestHandler,
  RequestSchema,
  ResolvedValidation,
  ResponseSchema,
  RouteReturn,
} from "./types.js";
import { buildRequestValidator, validateParts } from "./validate.js";

const emptyMiddlewares: readonly Middleware[] = [];

const toResponse = (value: RouteReturn): Response => {
  if (value instanceof Response) return value;

  if (typeof value === "string") return new Response(value);

  return Response.json(value);
};

const catchWithOnError = async (
  req: ApiRequest,
  onError: OnErrorOptions | undefined,
  run: () => Response | Promise<Response>,
  context?: ReturnType<typeof createContext>,
) => {
  try {
    return await run();
  } catch (error) {
    if (!onError) throw error;

    const errorContext = context ?? createContext(req);

    return applyHeaders(
      errorContext,
      await onError.handler(
        errorContext as Parameters<typeof onError.handler>[0],
        error,
      ),
    );
  }
};

const prepareResponse = (
  value: RouteReturn,
  responseSchema?: ResponseSchema,
) => {
  const response = toResponse(value);
  const schema = responseSchema?.[response.status];

  if (!schema) return response;

  if (value instanceof Response) {
    return response
      .clone()
      .json()
      .then((data) => checkOutput(schema, data, response));
  }

  return checkOutput(schema, value, response);
};

const buildBareRoute = (
  handler: BareRouteHandler,
  request?: RequestSchema,
  response?: ResponseSchema,
  validateInput = false,
  validateOutput = false,
  onError?: OnErrorOptions,
): RequestHandler => {
  const responseSchema = validateOutput ? response : undefined;
  const validateRequest = validateInput
    ? buildRequestValidator(request)
    : undefined;

  // Call the handler on every request: a Response body can only be sent once.
  const respond = () => {
    const value = handler();

    if (value instanceof Promise) {
      return value.then((resolved) =>
        prepareResponse(resolved, responseSchema),
      );
    }

    return prepareResponse(value, responseSchema);
  };

  let run: RequestHandler = respond;

  if (validateRequest) {
    run = async (req) => {
      const error = await validateRequest(req);

      if (error) return mapValidationError(error);

      return respond();
    };
  }

  if (!onError) return run;

  return (req) => catchWithOnError(req, onError, () => run(req));
};

const buildContextRoute = (
  handler: AnyRouteHandler,
  onError?: OnErrorOptions,
): RequestHandler => {
  return (req) => {
    const context = createContext(req);

    return catchWithOnError(
      req,
      onError,
      () => {
        const result = handler(context);

        if (result instanceof Promise) {
          return result.then((value) =>
            applyHeaders(context, toResponse(value)),
          );
        }

        return applyHeaders(context, toResponse(result));
      },
      context,
    );
  };
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

const handleRequest = async (req: ApiRequest, config: HandleRequestConfig) => {
  let extensions: Record<string, unknown> | undefined;
  let get: ((key: string) => unknown) | undefined;
  let bodyCache: BodyCache | undefined;

  if (config.cacheBody) {
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

  const context = createContext(req, emptyValidated, get);

  try {
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

      context.req = validated;

      const middlewareResult = await middlewareHandler(
        context as Parameters<typeof middlewareHandler>[0],
      );

      if (middlewareResult instanceof Response) {
        return applyHeaders(context, middlewareResult);
      }

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

    context.req = validated;

    if (jsonHandler) {
      context.json = jsonHandler;
    }

    const result = await config.handler(context);

    return applyHeaders(context, toResponse(result));
  } catch (error) {
    if (!config.onError) throw error;

    return applyHeaders(
      context,
      await config.onError.handler(
        context as Parameters<typeof config.onError.handler>[0],
        error,
      ),
    );
  }
};

const buildHandler = (
  route: AnyRouteConfig,
  validation: ResolvedValidation,
  onError?: OnErrorOptions,
): RequestHandler => {
  const middlewares = route.middlewares ?? emptyMiddlewares;
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
      onError,
    );
  }

  if (
    !hasMiddleware &&
    typeof handler === "function" &&
    handler.length === 1 &&
    !validateInput &&
    !validateOutput
  ) {
    return buildContextRoute(handler as AnyRouteHandler, onError);
  }

  const config: HandleRequestConfig = {
    middlewares,
    routeRequest: route.request,
    routeResponse: route.response,
    validateInput,
    validateOutput,
    cacheBody:
      validateInput &&
      bodyHasMultipleReaders({ middlewares, request: route.request }),
    handler: handler as AnyRouteHandler,
    onError,
  };

  return (req) => handleRequest(req, config);
};

const compileRoutes = (
  routes: AnyRouteConfig[],
  validation: ResolvedValidation,
  onError?: OnErrorOptions,
): MethodRoutes => {
  const methodRoutes: MethodRoutes = {};

  for (const route of routes) {
    let methods = methodRoutes[route.path];

    if (!methods) {
      methods = {};
      methodRoutes[route.path] = methods;
    }

    if (methods[route.method]) {
      throw new DuplicateRouteError(route.method, route.path);
    }

    methods[route.method] = buildHandler(route, validation, onError);
  }

  return methodRoutes;
};

export class Api<
  TMiddlewares extends readonly Middleware[] = readonly [],
  TErrorRes extends ResponseSchema | undefined = undefined,
> extends Group<TMiddlewares> {
  protected override options: ApiOptions<TMiddlewares, TErrorRes>;
  private compiled?: CompiledApi;
  private needsRecompile = true;

  public constructor(options: ApiOptions<TMiddlewares, TErrorRes> = {}) {
    super(options);
    this.options = options;
  }

  protected override onRoutesChanged() {
    this.needsRecompile = true;
    super.onRoutesChanged();
  }

  public fetch = (req: Request) => {
    return this.ensureCompiled().fetch(req);
  };

  public getRouteHandlers() {
    return this.ensureCompiled().routes;
  }

  public getOpenApiSpec() {
    return generateOpenApiSpec({
      title: this.options.openapi?.title ?? "API",
      description: this.options.openapi?.description,
      version: this.options.openapi?.version ?? "1.0.0",
      servers: this.options.openapi?.servers,
      securitySchemes: this.options.openapi?.securitySchemes,
      routes: this.collectRoutes(),
      errorResponses: this.options.onError?.response,
    });
  }

  // Async so startup errors reject on every runtime. On Bun nothing is
  // awaited before the callback, so it still runs synchronously.
  public async serve(port: number, callback?: (server: ApiServer) => void) {
    // Compile now so route config errors (duplicate routes) fail startup
    // instead of every request.
    this.ensureCompiled();

    let server: ApiServer;

    if (typeof Bun === "undefined") {
      server = await serveWithNode(port, this.fetch);
    } else {
      server = serveWithBun(port, this.fetch);
    }

    callback?.(server);

    return server;
  }

  private ensureCompiled() {
    if (!this.needsRecompile && this.compiled) return this.compiled;

    const routes = compileRoutes(
      this.collectRoutes(),
      resolveValidation(this.options.validation),
      this.options.onError as OnErrorOptions | undefined,
    );

    this.compiled = {
      routes,
      fetch: buildFetchDispatcher(routes),
    };

    this.needsRecompile = false;

    return this.compiled;
  }
}
