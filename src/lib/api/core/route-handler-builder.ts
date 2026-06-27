import type { StandardSchemaV1 } from "@standard-schema/spec";
import { validateBody } from "../validation/index.js";
import { sharedContextFactory } from "./context-factory.js";
import { RequestPipeline } from "./request-pipeline.js";
import { badRequest, validatingJson } from "./response-helpers.js";
import type {
  AnyRouteHandler,
  BareRouteHandler,
  BuildRouteHandlerInput,
  BunRouteHandler,
  ResponseSchema,
  RouteReturn,
} from "./types.js";
import { classifyRoute } from "./utils.js";

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

const buildSimpleHandler = (handler: AnyRouteHandler): BunRouteHandler => {
  return (req) => {
    return handler(sharedContextFactory.create({ req }));
  };
};

const buildOutputValidatedHandler = (input: {
  handler: AnyRouteHandler;
  responseSchema: ResponseSchema;
}): BunRouteHandler => {
  return (req) => {
    const context = sharedContextFactory.create({ req });
    context.json = validatingJson(input.responseSchema);

    return input.handler(context);
  };
};

const buildBodyOnlyHandler = (input: {
  handler: AnyRouteHandler;
  bodySchema: StandardSchemaV1;
}): BunRouteHandler => {
  return async (req) => {
    let body: unknown;

    try {
      body = await validateBody(req, input.bodySchema);
    } catch (error) {
      return badRequest((error as Error).message);
    }

    return input.handler(sharedContextFactory.createWithBody({ req, body }));
  };
};

export class RouteHandlerBuilder {
  public build(input: BuildRouteHandlerInput): BunRouteHandler {
    const allMiddlewares = [
      ...input.globalMiddlewares,
      ...(input.route.middlewares ?? []),
    ];

    const kind = classifyRoute({
      middlewares: allMiddlewares,
      request: input.route.request,
      response: input.route.response,
      validation: input.validation,
    });

    const handler = input.route.handler;

    if (kind === "simple") {
      if (isBareHandler(handler)) {
        return buildBareHandler(handler as BareRouteHandler);
      }

      return buildSimpleHandler(handler as AnyRouteHandler);
    }

    if (kind === "outputOnly") {
      return buildOutputValidatedHandler({
        handler: handler as AnyRouteHandler,
        responseSchema: input.route.response as ResponseSchema,
      });
    }

    if (kind === "bodyOnly") {
      return buildBodyOnlyHandler({
        handler: handler as AnyRouteHandler,
        bodySchema: input.route.request?.body as StandardSchemaV1,
      });
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
