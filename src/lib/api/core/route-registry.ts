import type { Middleware } from "../middleware/index.js";
import { RequestPipeline } from "./request-pipeline.js";
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

const buildRouteHandler = (input: BuildRouteHandlerInput): BunRouteHandler => {
  const allMiddlewares = [
    ...input.globalMiddlewares,
    ...(input.route.middlewares ?? []),
  ];

  const handler = input.route.handler;

  if (allMiddlewares.length === 0 && isBareHandler(handler)) {
    return buildBareHandler(handler as BareRouteHandler);
  }

  const pipeline = new RequestPipeline({
    middlewares: allMiddlewares,
    routeRequest: input.route.request,
    routeResponse: input.route.response,
    validateInput: input.validation.input,
    validateOutput: input.validation.output && !!input.route.response,
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
