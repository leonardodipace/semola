import type { Server } from "bun";
import { mightThrow } from "../errors/index.js";
import { RequestContext } from "./context.js";
import { generateOpenApiSpec } from "./openapi.js";
import {
  convertPathToBunFormat,
  parseCookies,
  parseQueryString,
} from "./router.js";
import type {
  ApiError,
  ApiOptions,
  InternalRoute,
  RequestSchema,
  ResponseSchema,
  RouteDefinition,
} from "./types.js";
import { validateSchema } from "./validator.js";

export class Api {
  private options: ApiOptions;
  private routes: InternalRoute[] = [];
  private server: Server<unknown> | null = null;

  constructor(options: ApiOptions = {}) {
    this.options = options;
  }

  private defaultErrorHandler(error: ApiError): Response {
    return Response.json(
      { message: error.message },
      { status: error.context?.statusCode || 500 },
    );
  }

  private async handleError(req: Request, error: ApiError): Promise<Response> {
    const handler = this.options.onError;

    if (!handler) {
      return this.defaultErrorHandler(error);
    }

    try {
      const response = await Promise.resolve(handler(error, req));

      if (!response || !(response instanceof Response)) {
        return this.defaultErrorHandler({
          type: "InternalServerError",
          message: "Internal server error",
          context: { statusCode: 500 },
        });
      }

      return response;
    } catch (_handlerError) {
      return this.defaultErrorHandler({
        type: "InternalServerError",
        message: "Internal server error",
        context: { statusCode: 500 },
      });
    }
  }

  public defineRoute<
    TRequest extends RequestSchema = RequestSchema,
    TResponse extends ResponseSchema = ResponseSchema,
  >(definition: RouteDefinition<TRequest, TResponse>): void {
    const fullPath = this.options.prefix
      ? `${this.options.prefix}${definition.path}`
      : definition.path;

    const bunPath = convertPathToBunFormat(fullPath);

    const wrappedHandler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const query = parseQueryString(url);
      const cookies = parseCookies(req.headers.get("cookie"));

      const params = (req as { params?: Record<string, string> }).params || {};

      let body: unknown;
      if (definition.request?.body) {
        const contentType = req.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const [parseError, parsedBody] = await mightThrow(req.json());
          if (parseError) {
            return this.handleError(req, {
              type: "ValidationError",
              message: "Invalid JSON body",
              context: { statusCode: 400 },
            });
          }
          body = parsedBody;
        }
      }

      const headers: Record<string, string> = {};
      if (definition.request?.headers) {
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });
      }

      const [bodyError, validatedBody] = await validateSchema(
        definition.request?.body,
        body,
      );
      if (bodyError) {
        return this.handleError(req, {
          type: "ValidationError",
          message: bodyError.message,
          context: { validationField: "body", statusCode: 400 },
        });
      }

      const [paramsError, validatedParams] = await validateSchema(
        definition.request?.params,
        params,
      );
      if (paramsError) {
        return this.handleError(req, {
          type: "ValidationError",
          message: paramsError.message,
          context: { validationField: "params", statusCode: 400 },
        });
      }

      const [queryError, validatedQuery] = await validateSchema(
        definition.request?.query,
        query,
      );
      if (queryError) {
        return this.handleError(req, {
          type: "ValidationError",
          message: queryError.message,
          context: { validationField: "query", statusCode: 400 },
        });
      }

      const [headersError, validatedHeaders] = await validateSchema(
        definition.request?.headers,
        headers,
      );
      if (headersError) {
        return this.handleError(req, {
          type: "ValidationError",
          message: headersError.message,
          context: { validationField: "headers", statusCode: 400 },
        });
      }

      const [cookiesError, validatedCookies] = await validateSchema(
        definition.request?.cookies,
        cookies,
      );
      if (cookiesError) {
        return this.handleError(req, {
          type: "ValidationError",
          message: cookiesError.message,
          context: { validationField: "cookies", statusCode: 400 },
        });
      }

      const validateResponseFn = async (status: number, data: unknown) => {
        const responseSchema = definition.response[status];
        return validateSchema(responseSchema, data);
      };

      const context = new RequestContext<TRequest, TResponse>(
        req,
        {
          body: validatedBody,
          params: validatedParams,
          query: validatedQuery,
          headers: validatedHeaders,
          cookies: validatedCookies,
        },
        validateResponseFn,
        (err) => this.handleError(req, err),
      );

      const handlerResult = definition.handler(context);
      const [handlerError, response] = await mightThrow(
        Promise.resolve(handlerResult),
      );

      if (handlerError) {
        return this.handleError(req, {
          type: "InternalServerError",
          message: "Internal server error",
          context: { statusCode: 500 },
        });
      }

      if (!response) {
        return this.handleError(req, {
          type: "InternalServerError",
          message: "Internal server error",
          context: { statusCode: 500 },
        });
      }

      return response;
    };

    this.routes.push({
      path: bunPath,
      method: definition.method,
      handler: wrappedHandler,
      definition,
    });
  }

  public async getOpenApiSpec() {
    return generateOpenApiSpec(this.routes, this.options);
  }

  public listen(port: number, callback?: () => void): Server<unknown> {
    const bunRoutes: Record<
      string,
      Record<string, (req: Request) => Promise<Response>>
    > = {};

    for (const route of this.routes) {
      const { path, method, handler } = route;

      if (!bunRoutes[path]) {
        bunRoutes[path] = {};
      }

      bunRoutes[path][method] = handler;
    }

    this.server = Bun.serve({
      port,
      routes: bunRoutes,
      fetch: (_req) => {
        return new Response("Not Found", { status: 404 });
      },
    });

    if (callback) {
      callback();
    }

    return this.server;
  }

  public close(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }
}

export type {
  ApiError,
  ApiOptions,
  ErrorHandler,
  HandlerContext,
  HttpMethod,
  RequestSchema,
  ResponseSchema,
  RouteDefinition,
  StatusCode,
} from "./types.js";
