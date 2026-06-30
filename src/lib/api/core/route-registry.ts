import type { Middleware } from "../middleware/index.js";
import { validateSchema } from "../validation/index.js";
import { buildRequestValidator } from "../validation/request-validator.js";
import { createContext } from "./context-factory.js";
import { RequestPipeline } from "./request-pipeline.js";
import { mapValidationError } from "./response-helpers.js";
import type {
  AnyRouteHandler,
  BareRouteHandler,
  BuildRouteHandlerInput,
  BunRouteHandler,
  MethodRoutes,
  RequestSchema,
  ResolvedValidation,
  ResponseSchema,
  RouteConfig,
  RouteReturn,
} from "./types.js";
import { getFullPath } from "./utils.js";

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

const wrapBareRoute = (
  validateRequest: ReturnType<typeof buildRequestValidator>,
  cached: Response | Promise<Response>,
): BunRouteHandler => {
  if (!validateRequest) {
    if (cached instanceof Promise) return async () => cached;

    return () => cached;
  }

  return async (req) => {
    const error = await validateRequest(req);

    if (error) return mapValidationError(error);

    return cached;
  };
};

const buildBareRoute = (
  handler: BareRouteHandler,
  request?: RequestSchema,
  response?: ResponseSchema,
  validateInput = false,
  validateOutput = false,
): BunRouteHandler => {
  const responseSchema = validateOutput ? response : undefined;
  const validateRequest = validateInput
    ? buildRequestValidator(request)
    : undefined;
  const probe = handler();

  if (probe instanceof Promise) {
    return async (req) => {
      if (validateRequest) {
        const error = await validateRequest(req);

        if (error) return mapValidationError(error);
      }

      const value = await handler();

      return validateResponse(value, responseSchema);
    };
  }

  const cached = prepareResponse(probe, responseSchema);

  return wrapBareRoute(validateRequest, cached);
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

const getRouteMiddlewares = (input: BuildRouteHandlerInput) => {
  if (!input.route.middlewares?.length) return input.globalMiddlewares;

  if (input.globalMiddlewares.length === 0) return input.route.middlewares;

  return [...input.globalMiddlewares, ...input.route.middlewares];
};

const isReturnValueHandler = (handler: unknown) => {
  return typeof handler === "function" && handler.length === 0;
};

const isContextHandler = (handler: unknown) => {
  return typeof handler === "function" && handler.length === 1;
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

const buildRouteHandler = (input: BuildRouteHandlerInput): BunRouteHandler => {
  const { route, validation } = input;
  const middlewares = getRouteMiddlewares(input);
  const handler = route.handler;

  const hasMiddleware = middlewares.length > 0;
  const validateInput = routeValidatesInput(
    validation,
    route.request,
    middlewares,
  );
  const validateOutput = validation.output && !!route.response;

  if (!hasMiddleware && isReturnValueHandler(handler)) {
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
    isContextHandler(handler) &&
    !validateInput &&
    !validateOutput
  ) {
    return buildContextRoute(handler as AnyRouteHandler);
  }

  const pipeline = new RequestPipeline({
    middlewares,
    routeRequest: route.request,
    routeResponse: route.response,
    validateInput,
    validateOutput,
    handler: handler as AnyRouteHandler,
  });

  return (req) => pipeline.handle(req);
};

export class RouteRegistry {
  private routes: RouteConfig<
    RequestSchema,
    ResponseSchema,
    readonly Middleware[],
    readonly Middleware[]
  >[] = [];
  private prefix?: string;

  public constructor(input: { prefix?: string }) {
    this.prefix = input.prefix;
  }

  public addRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TGlobal extends readonly Middleware[] = readonly [],
    TRoute extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TGlobal, TRoute>) {
    this.routes.push(
      config as RouteConfig<
        RequestSchema,
        ResponseSchema,
        readonly Middleware[],
        readonly Middleware[]
      >,
    );
  }

  public getRoutes() {
    return this.routes;
  }

  public buildRoutes(input: {
    globalMiddlewares?: readonly Middleware[];
    validation: ResolvedValidation;
  }): MethodRoutes {
    const bunRoutes: MethodRoutes = {};
    const globalMiddlewares = input.globalMiddlewares ?? emptyMiddlewares;

    for (const route of this.routes) {
      const fullPath = getFullPath({ prefix: this.prefix, path: route.path });

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][route.method] = buildRouteHandler({
        route,
        globalMiddlewares,
        validation: input.validation,
      });
    }

    return bunRoutes;
  }
}
