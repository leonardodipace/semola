import type { Server } from "bun";
import { mightThrow } from "../errors/index.js";
import { RequestContext } from "./context.js";
import { generateOpenApiSpec } from "./openapi.js";
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

  public defineRoute<
    TRequest extends RequestSchema = RequestSchema,
    TResponse extends ResponseSchema = ResponseSchema,
  >(definition: RouteDefinition<TRequest, TResponse>) {
    const fullPath = this.options.prefix
      ? `${this.options.prefix}${definition.path}`
      : definition.path;

    const bunPath = fullPath.replace(/\{(\w+)\}/g, ":$1");

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

      if (definition.request?.body) {
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

      if (definition.request?.headers) {
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });
      }

      // Validate all request fields
      const fieldsToValidate: Array<
        [string, unknown, RequestSchema[keyof RequestSchema]]
      > = [
        ["body", body, definition.request?.body],
        ["params", params, definition.request?.params],
        ["query", query, definition.request?.query],
        ["headers", headers, definition.request?.headers],
        ["cookies", cookies, definition.request?.cookies],
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
        const responseSchema = definition.response[status];

        return validateSchema(responseSchema, data);
      };

      const context = new RequestContext<TRequest, TResponse>(
        req,
        {
          body: validated.body as InferInput<TRequest["body"]>,
          params: validated.params as InferInput<TRequest["params"]>,
          query: validated.query as InferInput<TRequest["query"]>,
          headers: validated.headers as InferInput<TRequest["headers"]>,
          cookies: validated.cookies as InferInput<TRequest["cookies"]>,
        },
        validateResponseFn,
        async (err) =>
          Response.json(
            { message: err.message },
            { status: err.context?.statusCode ?? 500 },
          ),
      );

      const handlerResult = definition.handler(context);

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
  HandlerContext,
  HttpMethod,
  RequestSchema,
  ResponseSchema,
  RouteDefinition,
} from "./types.js";
