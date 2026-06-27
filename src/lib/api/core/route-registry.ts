import type { Middleware } from "../middleware/index.js";
import { validateSchema } from "../validation/index.js";
import { validateRequest } from "../validation/request-validator.js";
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

const isBareHandler = (handler: unknown) => {
  return typeof handler === "function" && handler.length === 0;
};

const toResponse = (value: RouteReturn): Response => {
  if (value instanceof Response) {
    return value;
  }

  if (typeof value === "string") {
    return new Response(value);
  }

  return Response.json(value);
};

const buildBareHandler = (handler: BareRouteHandler): BunRouteHandler => {
  const probe = handler();

  if (probe instanceof Promise) {
    return async () => toResponse(await handler());
  }

  const response = toResponse(probe);

  return () => response;
};

const toValidatedResponse = (
  value: RouteReturn,
  schema: ResponseSchema[number] | undefined,
) => {
  if (!schema) {
    return toResponse(value);
  }

  try {
    validateSchema(schema, value);

    return toResponse(value);
  } catch (error) {
    return badRequest((error as Error).message);
  }
};

const hasRequestSchema = (route: BuildRouteHandlerInput["route"]) => {
  return !!route.request;
};

const hasResponseSchema = (route: BuildRouteHandlerInput["route"]) => {
  return !!route.response;
};

const hasMiddlewareRequestSchema = (middlewares: readonly Middleware[]) => {
  for (const middleware of middlewares) {
    if (middleware.options.request) {
      return true;
    }
  }

  return false;
};

const buildValidatedBareRouteHandler = (
  handler: BareRouteHandler,
  request: RequestSchema | undefined,
  response: ResponseSchema | undefined,
  validateInput: boolean,
  validateOutput: boolean,
) => {
  const responseSchema = validateOutput ? response?.[200] : undefined;
  const probe = handler();

  if (probe instanceof Promise) {
    if (!validateInput) {
      return async () => {
        const value = await handler();

        return toValidatedResponse(value, responseSchema);
      };
    }

    return async (req: Bun.BunRequest) => {
      const validated = await validateRequest({ req, schema: request });

      if (!validated.success) {
        return badRequest(validated.error.message);
      }

      const value = await handler();

      return toValidatedResponse(value, responseSchema);
    };
  }

  const result = toValidatedResponse(probe, responseSchema);

  if (!validateInput) {
    return () => result;
  }

  return async (req: Bun.BunRequest) => {
    const validated = await validateRequest({ req, schema: request });

    if (!validated.success) {
      return badRequest(validated.error.message);
    }

    return result;
  };
};

const buildRouteHandler = (input: BuildRouteHandlerInput): BunRouteHandler => {
  const allMiddlewares = [
    ...input.globalMiddlewares,
    ...(input.route.middlewares ?? []),
  ];

  const handler = input.route.handler;
  const validateInput =
    input.validation.input &&
    (hasRequestSchema(input.route) ||
      hasMiddlewareRequestSchema(allMiddlewares));
  const validateOutput =
    input.validation.output && hasResponseSchema(input.route);

  if (allMiddlewares.length === 0 && isBareHandler(handler)) {
    if (!validateInput && !validateOutput) {
      return buildBareHandler(handler as BareRouteHandler);
    }

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

    for (const route of this.routes) {
      const fullPath = getFullPath({ prefix: this.prefix, path: route.path });

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][route.method] = buildRouteHandler({
        route,
        globalMiddlewares: input.globalMiddlewares ?? [],
        validation: input.validation,
      });
    }

    return bunRoutes;
  }
}
