import type { Server } from "bun";
import { mightThrow } from "../errors/index.js";
import { RequestContext } from "./context.js";
import { Middleware } from "./middleware.js";
import { generateOpenApiSpec } from "./openapi.js";
import {
  extractMiddlewareSchemas,
  mergeRequestSchemas,
  mergeResponseSchemas,
} from "./schema-merger.js";
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
  private globalMiddlewares: Middleware[] = [];

  public constructor(options: ApiOptions = {}) {
    this.options = options;
  }

  public use(middleware: Middleware): void {
    this.globalMiddlewares.push(middleware);
  }

  public defineRoute<
    TRequest extends RequestSchema = RequestSchema,
    TResponse extends ResponseSchema = ResponseSchema,
    TMiddlewares extends readonly Middleware[] = readonly [],
  >(definition: RouteDefinition<TRequest, TResponse, TMiddlewares>) {
    const fullPath = this.options.prefix
      ? `${this.options.prefix}${definition.path}`
      : definition.path;

    const bunPath = fullPath.replace(/\{(\w+)\}/g, ":$1");

    // Combine global and route-specific middlewares
    const allMiddlewares = [
      ...this.globalMiddlewares,
      ...(definition.middlewares ?? []),
    ];

    // Extract and merge middleware schemas
    const middlewareSchemas = extractMiddlewareSchemas(allMiddlewares);

    const mergedRequest = mergeRequestSchemas(
      middlewareSchemas.requestSchema,
      definition.request,
    );

    const mergedResponse = mergeResponseSchemas(
      middlewareSchemas.responseSchema,
      definition.response,
    );

    const wrappedHandler = async (req: Request) => {
      const url = new URL(req.url);

      // Parse query string
      const query: Record<string, string | string[]> = {};
      for (const [key, value] of url.searchParams.entries()) {
        const existing = query[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else if (existing) {
          query[key] = [existing, value];
        } else {
          query[key] = value;
        }
      }

      // Parse cookies
      const cookieHeader = req.headers.get("cookie");
      const cookies: Record<string, string> = {};
      if (cookieHeader) {
        for (const pair of cookieHeader.split(";")) {
          const equalsIndex = pair.indexOf("=");
          if (equalsIndex === -1) continue;
          const key = pair.slice(0, equalsIndex).trim();
          const value = pair.slice(equalsIndex + 1).trim();
          if (key && value) {
            cookies[key] = value;
          }
        }
      }

      const params = (req as { params?: Record<string, string> }).params ?? {};

      let body: unknown;

      if (mergedRequest.body) {
        const contentType = req.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const [parseError, parsedBody] = await mightThrow(req.json());

          if (parseError) {
            return Response.json(
              { message: "Invalid JSON body" },
              { status: 400 },
            );
          }

          body = parsedBody;
        }
      }

      const headers: Record<string, string> = {};

      if (mergedRequest.headers) {
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });
      }

      // Validate all request fields using merged schemas
      const fieldsToValidate: Array<
        [string, unknown, RequestSchema[keyof RequestSchema]]
      > = [
        ["body", body, mergedRequest.body],
        ["params", params, mergedRequest.params],
        ["query", query, mergedRequest.query],
        ["headers", headers, mergedRequest.headers],
        ["cookies", cookies, mergedRequest.cookies],
      ];

      const validated: Record<string, unknown> = {};

      for (const [fieldName, data, schema] of fieldsToValidate) {
        if (!schema) {
          validated[fieldName] = undefined;
          continue;
        }

        const [error, result] = await validateSchema(schema, data);

        if (error) {
          return Response.json({ message: error.message }, { status: 400 });
        }

        validated[fieldName] = result;
      }

      const validateResponseFn = async (status: number, data: unknown) => {
        const responseSchema = mergedResponse[status];

        return validateSchema(responseSchema, data);
      };

      const baseContext = new RequestContext<
        typeof mergedRequest,
        typeof mergedResponse
      >(
        req,
        {
          body: validated.body as InferInput<(typeof mergedRequest)["body"]>,
          params: validated.params as InferInput<
            (typeof mergedRequest)["params"]
          >,
          query: validated.query as InferInput<(typeof mergedRequest)["query"]>,
          headers: validated.headers as InferInput<
            (typeof mergedRequest)["headers"]
          >,
          cookies: validated.cookies as InferInput<
            (typeof mergedRequest)["cookies"]
          >,
        },
        validateResponseFn,
        async (err) =>
          Response.json(
            { message: err.message },
            { status: err.context?.statusCode ?? 500 },
          ),
      );

      // Execute middlewares in order
      const middlewareData: Record<string, unknown> = {};

      for (const middleware of allMiddlewares) {
        const [middlewareError, result] = await mightThrow(
          middleware.execute(baseContext),
        );

        if (middlewareError) {
          return Response.json(
            { message: Api.INTERNAL_SERVER_ERROR.message },
            { status: 500 },
          );
        }

        // Check if middleware returned early (Response)
        if (Middleware.isResponse(result)) {
          return result;
        }

        // Collect context data
        Object.assign(middlewareData, result);
      }

      // Create extended context with middleware data
      const extendedContext = Object.assign(baseContext, {
        get: <K extends string>(key: K) => middlewareData[key],
      });

      // @ts-expect-error - Runtime context extension; middleware data is validated at runtime
      const handlerResult = definition.handler(extendedContext);

      const [handlerError, response] = await mightThrow(
        Promise.resolve(handlerResult),
      );

      if (handlerError || !response) {
        return Response.json(
          { message: Api.INTERNAL_SERVER_ERROR.message },
          { status: 500 },
        );
      }

      return response;
    };

    this.routes.push({
      path: bunPath,
      method: definition.method,
      handler: wrappedHandler,
      definition: {
        ...definition,
        request: mergedRequest,
        response: mergedResponse,
      },
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
  MiddlewareData,
  MiddlewareDefinition,
  MiddlewareHandler,
  MiddlewareResult,
} from "./middleware.js";
export { Middleware } from "./middleware.js";
export type {
  ApiError,
  ApiOptions,
  HandlerContext,
  HttpMethod,
  RequestSchema,
  ResponseSchema,
  RouteDefinition,
} from "./types.js";
