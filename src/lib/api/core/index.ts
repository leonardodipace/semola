import { err, ok } from "../../errors/index.js";
import type { Middleware } from "../middleware/index.js";
import { generateOpenApiSpec } from "../openapi/index.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
} from "../validation/index.js";
import type {
  ApiOptions,
  Context,
  InferInput,
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
} from "./types.js";

export class Api<TMiddlewares extends readonly Middleware[] = readonly []> {
  private options: ApiOptions<TMiddlewares>;
  private routes: RouteConfig<
    RequestSchema,
    ResponseSchema,
    TMiddlewares,
    readonly Middleware[]
  >[] = [];

  public constructor(options: ApiOptions<TMiddlewares>) {
    this.options = options;
  }

  private getFullPath(path: string) {
    if (!this.options.prefix) return path;

    const fullPath = this.options.prefix + path;

    // Remove trailing slash
    if (fullPath.endsWith("/")) {
      return fullPath.slice(0, -1);
    }

    return fullPath;
  }

  private async validateRequest(req: Bun.BunRequest, schema?: RequestSchema) {
    const [
      [bodyErr, body],
      [queryErr, query],
      [headersErr, headers],
      [cookiesErr, cookies],
      [paramsErr, params],
    ] = await Promise.all([
      validateBody(req, schema?.body),
      validateQuery(req, schema?.query),
      validateHeaders(req, schema?.headers),
      validateCookies(req, schema?.cookies),
      validateParams(req, schema?.params),
    ]);

    const error = bodyErr || queryErr || headersErr || cookiesErr || paramsErr;

    if (error) {
      return err(error.type, error.message);
    }

    return ok({ body, query, headers, cookies, params });
  }

  private createContext<
    TReq extends RequestSchema,
    TRes extends ResponseSchema,
    TExt extends Record<string, unknown> = Record<string, unknown>,
  >(params: {
    request: Request;
    validatedBody: InferInput<TReq["body"]>;
    validatedQuery: InferInput<TReq["query"]>;
    validatedHeaders: InferInput<TReq["headers"]>;
    validatedCookies: InferInput<TReq["cookies"]>;
    validatedParams: InferInput<TReq["params"]>;
    extensions: Record<string, unknown>;
  }) {
    const ctx: Context<TReq, TRes, TExt> = {
      raw: params.request,
      req: {
        body: params.validatedBody,
        query: params.validatedQuery,
        headers: params.validatedHeaders,
        cookies: params.validatedCookies,
        params: params.validatedParams,
      },
      json: (status, data) => {
        return Response.json(data, { status });
      },
      text: (status, text) => {
        return new Response(text, { status });
      },
      get: <K extends keyof TExt>(key: K) =>
        params.extensions[key as string] as TExt[K],
    };

    return ctx;
  }

  private buildBunRoutes() {
    const bunRoutes: MethodRoutes = {};

    for (const route of this.routes) {
      const { path, method, handler, request, middlewares } = route;

      const fullPath = this.getFullPath(path);

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][method] = async (req: Bun.BunRequest) => {
        // Run middlewares
        const extensions: Record<string, unknown> = {};
        const allMiddlewares = [
          ...(this.options.middlewares ?? []),
          ...(middlewares ?? []),
        ];

        for (const mw of allMiddlewares) {
          const { request: reqSchema, handler: mwHandler } = mw.options;

          const [error, validated] = await this.validateRequest(req, reqSchema);

          if (error) {
            return Response.json({ message: error.message }, { status: 400 });
          }

          const { body, query, headers, cookies, params } = validated;

          const result = await mwHandler({
            raw: req,
            req: { body, query, headers, cookies, params },
            json: (status: number, data: unknown) =>
              Response.json(data, { status }),
            text: (status: number, text: string) =>
              new Response(text, { status }),
            get: () => {
              throw new Error("get() not available in middleware");
            },
          });

          if (result instanceof Response) {
            return result;
          }

          if (result) {
            Object.assign(extensions, result);
          }
        }

        const [routeError, routeValidated] = await this.validateRequest(
          req,
          request,
        );

        if (routeError) {
          return Response.json(
            { message: routeError.message },
            { status: 400 },
          );
        }

        const {
          body: validatedBody,
          query: validatedQuery,
          headers: validatedHeaders,
          cookies: validatedCookies,
          params: validatedParams,
        } = routeValidated;

        const ctx = this.createContext({
          request: req,
          validatedBody,
          validatedQuery,
          validatedHeaders,
          validatedCookies,
          validatedParams,
          extensions,
        }) as Parameters<typeof handler>[0];

        return handler(ctx);
      };
    }

    return bunRoutes;
  }

  public defineRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TRouteMiddlewares extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TMiddlewares, TRouteMiddlewares>) {
    this.routes.push(
      config as RouteConfig<
        RequestSchema,
        ResponseSchema,
        TMiddlewares,
        readonly Middleware[]
      >,
    );
  }

  public getOpenApiSpec() {
    return generateOpenApiSpec({
      title: this.options.openapi?.title ?? "API",
      description: this.options.openapi?.description,
      version: this.options.openapi?.version ?? "1.0.0",
      prefix: this.options.prefix,
      servers: this.options.openapi?.servers,
      securitySchemes: this.options.openapi?.securitySchemes,
      routes: this.routes,
      globalMiddlewares: this.options.middlewares,
    });
  }

  public serve(port: number, callback?: (server: Bun.Server<unknown>) => void) {
    const bunRoutes = this.buildBunRoutes();

    const server = Bun.serve({
      port,
      routes: bunRoutes,
      fetch: () => new Response("Not found", { status: 404 }),
    });

    if (callback) {
      callback(server);
    }
  }
}
