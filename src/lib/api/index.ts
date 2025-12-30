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
  InferInput,
  InternalRoute,
  RequestSchema,
  ResponseSchema,
  RouteDefinition,
} from "./types.js";
import { validateSchema } from "./validator.js";

export class Api {
  private static readonly INTERNAL_SERVER_ERROR: ApiError = {
    type: "InternalServerError",
    message: "Internal server error",
    context: { statusCode: 500 },
  };

  private options: ApiOptions;
  private routes: InternalRoute[] = [];
  private server: Server<unknown> | null = null;

  constructor(options: ApiOptions = {}) {
    this.options = options;
  }

  private defaultErrorHandler(error: ApiError) {
    return Response.json(
      { message: error.message },
      { status: error.context?.statusCode ?? 500 },
    );
  }

  private async handleError(req: Request, error: ApiError) {
    const handler = this.options.onError;

    if (!handler) {
      return this.defaultErrorHandler(error);
    }

    const [handlerError, response] = await mightThrow(
      Promise.resolve().then(() => handler(error, req)),
    );

    if (handlerError || !response || !(response instanceof Response)) {
      return this.defaultErrorHandler(Api.INTERNAL_SERVER_ERROR);
    }

    return response;
  }

  private async validateRequestField(
    req: Request,
    schema: RequestSchema[keyof RequestSchema],
    data: unknown,
    fieldName: string,
  ) {
    const [error, validated] = await validateSchema(schema, data);

    if (error) {
      const response = await this.handleError(req, {
        type: "ValidationError",
        message: error.message,
        context: { validationField: fieldName, statusCode: 400 },
      });

      return [response, null] as const;
    }

    return [null, validated] as const;
  }

  public defineRoute<
    TRequest extends RequestSchema = RequestSchema,
    TResponse extends ResponseSchema = ResponseSchema,
  >(definition: RouteDefinition<TRequest, TResponse>) {
    const fullPath = this.options.prefix
      ? `${this.options.prefix}${definition.path}`
      : definition.path;

    const bunPath = convertPathToBunFormat(fullPath);

    const wrappedHandler = async (req: Request) => {
      const url = new URL(req.url);
      const query = parseQueryString(url);
      const cookies = parseCookies(req.headers.get("cookie"));

      const params = (req as { params?: Record<string, string> }).params ?? {};

      let body: unknown;

      if (definition.request?.body) {
        const contentType = req.headers.get("content-type") ?? "";

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

      const [bodyError, validatedBody] = await this.validateRequestField(
        req,
        definition.request?.body,
        body,
        "body",
      );

      if (bodyError) return bodyError;

      const [paramsError, validatedParams] = await this.validateRequestField(
        req,
        definition.request?.params,
        params,
        "params",
      );

      if (paramsError) return paramsError;

      const [queryError, validatedQuery] = await this.validateRequestField(
        req,
        definition.request?.query,
        query,
        "query",
      );

      if (queryError) return queryError;

      const [headersError, validatedHeaders] = await this.validateRequestField(
        req,
        definition.request?.headers,
        headers,
        "headers",
      );

      if (headersError) return headersError;

      const [cookiesError, validatedCookies] = await this.validateRequestField(
        req,
        definition.request?.cookies,
        cookies,
        "cookies",
      );

      if (cookiesError) return cookiesError;

      const validateResponseFn = async (status: number, data: unknown) => {
        const responseSchema = definition.response[status];

        return validateSchema(responseSchema, data);
      };

      const context = new RequestContext<TRequest, TResponse>(
        req,
        {
          body: validatedBody as InferInput<TRequest["body"]>,
          params: validatedParams as InferInput<TRequest["params"]>,
          query: validatedQuery as InferInput<TRequest["query"]>,
          headers: validatedHeaders as InferInput<TRequest["headers"]>,
          cookies: validatedCookies as InferInput<TRequest["cookies"]>,
        },
        validateResponseFn,
        (err) => this.handleError(req, err),
      );

      const handlerResult = definition.handler(context);

      const [handlerError, response] = await mightThrow(
        Promise.resolve(handlerResult),
      );

      if (handlerError || !response) {
        return this.handleError(req, Api.INTERNAL_SERVER_ERROR);
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

  public listen(port: number, callback?: () => void) {
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

  public close() {
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
