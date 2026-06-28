import { validateRequestInto } from "../validation/request-validator.js";
import type { BodyCache } from "../validation/types.js";
import { createContext, getEmptyValidated } from "./context-factory.js";
import { badRequest, validatingJson } from "./response-helpers.js";
import type { RequestPipelineConfig } from "./types.js";
import { bodyHasMultipleReaders } from "./utils.js";

export class RequestPipeline {
  private needsBodyCache = false;
  private jsonHandler?: (status: number, data: unknown) => Response;

  public constructor(private config: RequestPipelineConfig) {
    if (
      config.validateInput &&
      bodyHasMultipleReaders({
        middlewares: config.middlewares,
        request: config.routeRequest,
      })
    ) {
      this.needsBodyCache = true;
    }

    if (config.validateOutput && config.routeResponse) {
      this.jsonHandler = validatingJson(config.routeResponse);
    }
  }

  public async handle(req: Bun.BunRequest) {
    let extensions: Record<string, unknown> | undefined;
    let get: ((key: string) => unknown) | undefined;
    let bodyCache: BodyCache | undefined;

    if (this.needsBodyCache) {
      bodyCache = { parsed: false, value: undefined };
    }

    if (this.config.middlewares.length > 0) {
      get = (key: string) => {
        return extensions?.[key];
      };
    }

    for (const middleware of this.config.middlewares) {
      const { request: requestSchema, handler: middlewareHandler } =
        middleware.options;

      let validated = getEmptyValidated();

      if (this.config.validateInput && requestSchema) {
        const data = {};
        const error = await validateRequestInto(
          { req, schema: requestSchema, bodyCache },
          data,
        );

        if (error) return badRequest(error.message);

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

    let validated = getEmptyValidated();

    if (this.config.validateInput && this.config.routeRequest) {
      const data = {};
      const error = await validateRequestInto(
        { req, schema: this.config.routeRequest, bodyCache },
        data,
      );

      if (error) return badRequest(error.message);

      validated = data;
    }

    const context = createContext(req, validated, get, this.jsonHandler);

    return this.config.handler(context);
  }
}
