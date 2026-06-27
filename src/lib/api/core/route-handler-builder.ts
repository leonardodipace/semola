import type { StandardSchemaV1 } from "@standard-schema/spec";
import { validateBody } from "../validation/index.js";
import { sharedContextFactory } from "./context-factory.js";
import { RequestPipeline } from "./request-pipeline.js";
import { badRequest, validatingJson } from "./response-helpers.js";
import type {
  AnyRouteHandler,
  BuildRouteHandlerInput,
  BunRouteHandler,
  ResponseSchema,
} from "./types.js";
import { classifyRoute } from "./utils.js";

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

    const handler = input.route.handler as AnyRouteHandler;

    if (kind === "simple") {
      return buildSimpleHandler(handler);
    }

    if (kind === "outputOnly") {
      return buildOutputValidatedHandler({
        handler,
        responseSchema: input.route.response as ResponseSchema,
      });
    }

    if (kind === "bodyOnly") {
      return buildBodyOnlyHandler({
        handler,
        bodySchema: input.route.request?.body as StandardSchemaV1,
      });
    }

    const pipeline = new RequestPipeline({
      middlewares: allMiddlewares,
      routeRequest: input.route.request,
      routeResponse: input.route.response,
      validateInput: input.validation.input,
      validateOutput: input.validation.output && !!input.route.response,
      handler,
    });

    return (req) => {
      return pipeline.handle(req);
    };
  }
}
