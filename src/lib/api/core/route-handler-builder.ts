import { RequestPipeline } from "./request-pipeline.js";
import type {
  AnyRouteHandler,
  BareRouteHandler,
  BuildRouteHandlerInput,
  BunRouteHandler,
  RouteReturn,
} from "./types.js";

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

export class RouteHandlerBuilder {
  public build(input: BuildRouteHandlerInput): BunRouteHandler {
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
  }
}
