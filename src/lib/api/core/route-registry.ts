import type { Middleware } from "../middleware/index.js";
import { validateSchema } from "../validation/index.js";
import { buildRequestValidator } from "../validation/request-validator.js";
import { RequestPipeline } from "./request-pipeline.js";
import { badRequest } from "./response-helpers.js";
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

const isBareHandler = (handler: unknown) => {
  return typeof handler === "function" && handler.length === 0;
};

const toResponse = (value: RouteReturn): Response => {
  if (value instanceof Response) return value;

  if (typeof value === "string") return new Response(value);

  return Response.json(value);
};

const buildBareHandler = (handler: BareRouteHandler): BunRouteHandler => {
  return async () => {
    const value = await handler();

    return toResponse(value);
  };
};

const toValidatedResponse = (
  value: RouteReturn,
  schema: ResponseSchema[number] | undefined,
) => {
  if (!schema) return toResponse(value);

  try {
    validateSchema(schema, value);
  } catch (error) {
    return badRequest((error as Error).message);
  }

  return toResponse(value);
};

const hasMiddlewareRequestSchema = (middlewares: readonly Middleware[]) => {
  for (const middleware of middlewares) {
    if (middleware.options.request) return true;
  }

  return false;
};

const getRouteMiddlewares = (input: BuildRouteHandlerInput) => {
  if (!input.route.middlewares?.length) return input.globalMiddlewares;

  if (input.globalMiddlewares.length === 0) return input.route.middlewares;

  return [...input.globalMiddlewares, ...input.route.middlewares];
};

const shouldValidateInput = (
  input: BuildRouteHandlerInput,
  middlewares: readonly Middleware[],
) => {
  if (!input.validation.input) return false;
  if (input.route.request) return true;

  return hasMiddlewareRequestSchema(middlewares);
};

const buildValidatedBareRouteHandler = (
  handler: BareRouteHandler,
  request: RequestSchema | undefined,
  response: ResponseSchema | undefined,
  validateInput: boolean,
  validateOutput: boolean,
) => {
  let responseSchema = response?.[200];

  if (!validateOutput) {
    responseSchema = undefined;
  }

  let requestValidator = buildRequestValidator(request);

  if (!validateInput) {
    requestValidator = undefined;
  }

  if (!requestValidator) {
    return async () => {
      const value = await handler();

      return toValidatedResponse(value, responseSchema);
    };
  }

  return async (req: Bun.BunRequest) => {
    const error = await requestValidator(req);

    if (error) return badRequest(error.message);

    const value = await handler();

    return toValidatedResponse(value, responseSchema);
  };
};

const buildRouteHandler = (input: BuildRouteHandlerInput): BunRouteHandler => {
  const allMiddlewares = getRouteMiddlewares(input);
  const handler = input.route.handler;
  const validateInput = shouldValidateInput(input, allMiddlewares);
  const validateOutput = input.validation.output && !!input.route.response;

  if (allMiddlewares.length === 0 && isBareHandler(handler)) {
    if (!validateInput && !validateOutput)
      return buildBareHandler(handler as BareRouteHandler);

    return buildValidatedBareRouteHandler(
      handler as BareRouteHandler,
      input.route.request,
      input.route.response,
      validateInput,
      validateOutput,
    );
  }

  const pipeline = new RequestPipeline({
    middlewares: allMiddlewares,
    routeRequest: input.route.request,
    routeResponse: input.route.response,
    validateInput,
    validateOutput,
    handler: handler as AnyRouteHandler,
  });

  return (req) => {
    return pipeline.handle(req);
  };
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
