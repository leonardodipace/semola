import type { Middleware } from "../middleware/index.js";
import { RequestValidator } from "../validation/request-validator.js";
import type { BodyCache } from "../validation/types.js";
import { sharedContextFactory } from "./context-factory.js";
import { badRequest } from "./response-helpers.js";
import type { RequestPipelineConfig, ValidatedRequest } from "./types.js";
import { bodyHasMultipleReaders, hasRequestSchemas } from "./utils.js";

export class RequestPipeline {
  private config: RequestPipelineConfig;
  private validator = new RequestValidator();
  private contextFactory = sharedContextFactory;
  private bodyCache?: BodyCache;

  public constructor(config: RequestPipelineConfig) {
    this.config = config;

    if (
      config.validateInput &&
      bodyHasMultipleReaders({
        middlewares: config.middlewares,
        request: config.routeRequest,
      })
    ) {
      this.bodyCache = { parsed: false, value: undefined };
    }
  }

  public async handle(req: Bun.BunRequest) {
    const extensions: Record<string, unknown> = {};

    for (const middleware of this.config.middlewares) {
      const shortCircuit = await this.runMiddleware({
        middleware,
        req,
        extensions,
      });

      if (shortCircuit) {
        return shortCircuit;
      }
    }

    const validated = await this.validateRouteRequest(req);

    if (!validated.success) {
      return badRequest(validated.error.message);
    }

    const context = this.contextFactory.create({
      req,
      validated: validated.data,
      extensions,
      response: this.config.routeResponse,
      validateOutput: this.config.validateOutput,
    });

    return this.config.handler(context);
  }

  private async runMiddleware(input: {
    middleware: Middleware;
    req: Bun.BunRequest;
    extensions: Record<string, unknown>;
  }) {
    const { request: requestSchema, handler: middlewareHandler } =
      input.middleware.options;

    let validated = this.contextFactory.getEmptyValidated();

    if (this.config.validateInput && hasRequestSchemas(requestSchema)) {
      const result = await this.validator.validate({
        req: input.req,
        schema: requestSchema,
        bodyCache: this.bodyCache,
      });

      if (!result.success) {
        return badRequest(result.error.message);
      }

      validated = result.data as ValidatedRequest;
    }

    const context = this.contextFactory.create({
      req: input.req,
      validated,
      extensions: input.extensions,
    });

    const middlewareResult = await middlewareHandler(
      context as Parameters<typeof middlewareHandler>[0],
    );

    if (middlewareResult instanceof Response) {
      return middlewareResult;
    }

    if (middlewareResult) {
      Object.assign(input.extensions, middlewareResult);
    }
  }

  private async validateRouteRequest(req: Bun.BunRequest) {
    if (!this.config.validateInput) {
      return {
        success: true as const,
        data: this.contextFactory.getEmptyValidated(),
      };
    }

    if (!hasRequestSchemas(this.config.routeRequest)) {
      return {
        success: true as const,
        data: this.contextFactory.getEmptyValidated(),
      };
    }

    const result = await this.validator.validate({
      req,
      schema: this.config.routeRequest,
      bodyCache: this.bodyCache,
    });

    if (!result.success) {
      return result;
    }

    return {
      success: true as const,
      data: result.data as ValidatedRequest,
    };
  }
}
