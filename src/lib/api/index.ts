import type { Server } from "bun";
import { mightThrow } from "../errors/index.js";
import { RequestContext } from "./context.js";
import type { Middleware } from "./middleware.js";
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
  private globalMiddlewares: Middleware[] = [];

  public constructor(options: ApiOptions = {}) {
    this.options = options;
  }

  public use(middleware: Middleware) {
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

    const allMiddlewares = [
      ...this.globalMiddlewares,
      ...(definition.middlewares ?? []),
    ];

    const mergedRequest = this.mergeRequestSchemas(
      ...allMiddlewares.map((m) => m.definition.request),
      definition.request,
    );
    const mergedResponse = this.mergeResponseSchemas(
      ...allMiddlewares.map((m) => m.definition.response),
      definition.response,
    );

    const wrappedHandler = async (req: Request) => {
      const parseResult = await this.parseRequest(req, mergedRequest);
      if (parseResult instanceof Response) return parseResult;

      // Validate only the route's own request schema upfront
      const validateResult = await this.validateRequestFields(
        parseResult,
        definition.request ?? {},
      );
      if (validateResult instanceof Response) return validateResult;

      const baseContext = this.createBaseContext(
        req,
        validateResult,
        mergedRequest,
        mergedResponse,
      );

      // Execute middlewares with per-middleware validation
      const middlewareResult = await this.executeMiddlewares(
        allMiddlewares,
        baseContext,
        parseResult,
      );
      if (middlewareResult instanceof Response) return middlewareResult;

      const extendedContext = this.extendContext(baseContext, middlewareResult);

      // @ts-expect-error - Extended context type is correct at runtime
      return this.executeHandler(definition.handler, extendedContext);
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

  private parseQueryString(url: URL) {
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
    return query;
  }

  private parseCookies(cookieHeader: string | null) {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;

    for (const pair of cookieHeader.split(";")) {
      const equalsIndex = pair.indexOf("=");
      if (equalsIndex === -1) continue;
      const key = pair.slice(0, equalsIndex).trim();
      const value = pair.slice(equalsIndex + 1).trim();
      if (key && value) cookies[key] = value;
    }
    return cookies;
  }

  private async parseBody(req: Request, hasBodySchema: boolean) {
    if (!hasBodySchema) return [null, undefined] as const;

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return [null, undefined] as const;
    }

    const [parseError, parsedBody] = await mightThrow(req.json());
    if (parseError) {
      return [
        Response.json({ message: "Invalid JSON body" }, { status: 400 }),
        null,
      ] as const;
    }

    return [null, parsedBody] as const;
  }

  private extractHeaders(req: Request, hasHeaderSchema: boolean) {
    if (!hasHeaderSchema) return {};

    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  private async parseRequest(req: Request, schema: RequestSchema) {
    const url = new URL(req.url);
    const query = this.parseQueryString(url);
    const cookies = this.parseCookies(req.headers.get("cookie"));
    const params =
      (req as Request & { params?: Record<string, string> }).params ?? {};
    const headers = this.extractHeaders(req, !!schema.headers);

    const [bodyError, body] = await this.parseBody(req, !!schema.body);
    if (bodyError) return bodyError;

    return { body, params, query, headers, cookies };
  }

  private async validateRequestFields(
    data: {
      body: unknown;
      params: Record<string, string>;
      query: Record<string, string | string[]>;
      headers: Record<string, string>;
      cookies: Record<string, string>;
    },
    schema: RequestSchema,
  ) {
    const fieldsToValidate = [
      ["body", data.body, schema.body],
      ["params", data.params, schema.params],
      ["query", data.query, schema.query],
      ["headers", data.headers, schema.headers],
      ["cookies", data.cookies, schema.cookies],
    ] as const;

    for (const [_fieldName, fieldData, fieldSchema] of fieldsToValidate) {
      if (!fieldSchema) continue;

      const [error] = await validateSchema(fieldSchema, fieldData);
      if (error) {
        return Response.json({ message: error.message }, { status: 400 });
      }
    }

    return data;
  }

  private createBaseContext<
    TRequest extends RequestSchema,
    TResponse extends ResponseSchema,
  >(
    req: Request,
    validatedData: {
      body: unknown;
      params: Record<string, string>;
      query: Record<string, string | string[]>;
      headers: Record<string, string>;
      cookies: Record<string, string>;
    },
    _requestSchema: TRequest,
    responseSchema: TResponse,
  ) {
    const validateResponseFn = async (status: number, data: unknown) => {
      const schema = responseSchema[status];
      return validateSchema(schema, data);
    };

    const handleErrorFn = async (err: ApiError) =>
      Response.json(
        { message: err.message },
        { status: err.context?.statusCode ?? 500 },
      );

    return new RequestContext<TRequest, TResponse>(
      req,
      {
        body: validatedData.body as InferInput<TRequest["body"]>,
        params: validatedData.params as InferInput<TRequest["params"]>,
        query: validatedData.query as InferInput<TRequest["query"]>,
        headers: validatedData.headers as InferInput<TRequest["headers"]>,
        cookies: validatedData.cookies as InferInput<TRequest["cookies"]>,
      },
      validateResponseFn,
      handleErrorFn,
    );
  }

  private async executeMiddlewares(
    middlewares: Middleware[],
    context: RequestContext,
    parsedData: {
      body: unknown;
      params: Record<string, string>;
      query: Record<string, string | string[]>;
      headers: Record<string, string>;
      cookies: Record<string, string>;
    },
  ) {
    const data: Record<string, unknown> = {};

    for (const middleware of middlewares) {
      // Validate middleware's request schema before executing its handler
      if (middleware.definition.request) {
        const validateResult = await this.validateRequestFields(
          parsedData,
          middleware.definition.request,
        );
        if (validateResult instanceof Response) return validateResult;
      }

      const [error, result] = await mightThrow(
        Promise.resolve(middleware.definition.handler(context)),
      );

      if (error) {
        return Response.json(
          { message: Api.INTERNAL_SERVER_ERROR.message },
          { status: 500 },
        );
      }

      if (result instanceof Response) {
        return result;
      }

      Object.assign(data, result);
    }

    return data;
  }

  private extendContext(
    baseContext: RequestContext,
    middlewareData: Record<string, unknown>,
  ) {
    return Object.assign(baseContext, {
      get: <K extends string>(key: K) => middlewareData[key],
    });
  }

  private async executeHandler<T>(
    handler: (context: T) => unknown,
    context: T,
  ) {
    const [error, response] = await mightThrow(
      Promise.resolve(handler(context)),
    );

    if (error || !response) {
      return Response.json(
        { message: Api.INTERNAL_SERVER_ERROR.message },
        { status: 500 },
      );
    }

    return response as Response;
  }

  private mergeRequestSchemas(...schemas: (RequestSchema | undefined)[]) {
    const merged: RequestSchema = {};

    for (const schema of schemas) {
      if (!schema) continue;
      if (schema.body) merged.body = schema.body;
      if (schema.params) merged.params = schema.params;
      if (schema.query) merged.query = schema.query;
      if (schema.headers) merged.headers = schema.headers;
      if (schema.cookies) merged.cookies = schema.cookies;
    }

    return merged;
  }

  private mergeResponseSchemas(...schemas: (ResponseSchema | undefined)[]) {
    const merged: ResponseSchema = {};

    for (const schema of schemas) {
      if (!schema) continue;
      Object.assign(merged, schema);
    }

    return merged;
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
