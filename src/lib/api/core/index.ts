import { err, ok } from "../../errors/index.js";
import type { Middleware } from "../middleware/index.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
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

export class Api {
  private options: ApiOptions;
  private routes: RouteConfig<
    RequestSchema,
    ResponseSchema,
    readonly Middleware[]
  >[] = [];

  public constructor(options: ApiOptions) {
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

  private async validateRequest(req: Request, schema?: RequestSchema) {
    const [
      [bodyErr, body],
      [queryErr, query],
      [headersErr, headers],
      [cookiesErr, cookies],
    ] = await Promise.all([
      validateBody(req, schema?.body),
      validateQuery(req, schema?.query),
      validateHeaders(req, schema?.headers),
      validateCookies(req, schema?.cookies),
    ]);

    const error = bodyErr || queryErr || headersErr || cookiesErr;

    if (error) {
      return err(error.type, error.message);
    }

    return ok({ body, query, headers, cookies });
  }

  private createContext<
    TReq extends RequestSchema,
    TRes extends ResponseSchema,
  >(params: {
    request: Request;
    validatedBody: InferInput<TReq["body"]>;
    validatedQuery: InferInput<TReq["query"]>;
    validatedHeaders: InferInput<TReq["headers"]>;
    validatedCookies: InferInput<TReq["cookies"]>;
    extensions: Record<string, unknown>;
  }) {
    const ctx: Context<TReq, TRes> = {
      raw: params.request,
      req: {
        body: params.validatedBody,
        query: params.validatedQuery,
        headers: params.validatedHeaders,
        cookies: params.validatedCookies,
      },
      json: (status, data) => {
        return Response.json(data, { status });
      },
      text: (status, text) => {
        return new Response(text, { status });
      },
      get: <T>(key: string) => params.extensions[key] as T,
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

      bunRoutes[fullPath][method] = async (req) => {
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

          const { body, query, headers, cookies } = validated;

          const result = await mwHandler({
            raw: req,
            req: { body, query, headers, cookies },
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
        } = routeValidated;

        const ctx = this.createContext({
          request: req,
          validatedBody,
          validatedQuery,
          validatedHeaders,
          validatedCookies,
          extensions,
        });

        return handler(ctx);
      };
    }

    return bunRoutes;
  }

  public defineRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TMiddlewares extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TMiddlewares>) {
    this.routes.push(config);
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
