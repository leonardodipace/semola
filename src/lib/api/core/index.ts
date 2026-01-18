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
  private routes: RouteConfig[] = [];

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

  private createContext<
    TReq extends RequestSchema,
    TRes extends ResponseSchema,
  >(params: {
    request: Request;
    validatedBody: InferInput<TReq["body"]>;
    validatedQuery: InferInput<TReq["query"]>;
    validatedHeaders: InferInput<TReq["headers"]>;
    validatedCookies: InferInput<TReq["cookies"]>;
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
    };

    return ctx;
  }

  private buildBunRoutes() {
    const bunRoutes: MethodRoutes = {};

    for (const route of this.routes) {
      const { path, method, handler, request } = route;

      const fullPath = this.getFullPath(path);

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][method] = async (req) => {
        // Run all validations in parallel
        const [
          [bodyErr, validatedBody],
          [queryErr, validatedQuery],
          [headersErr, validatedHeaders],
          [cookiesErr, validatedCookies],
        ] = await Promise.all([
          validateBody(req, request?.body),
          validateQuery(req, request?.query),
          validateHeaders(req, request?.headers),
          validateCookies(req, request?.cookies),
        ]);

        // Check for errors in order
        if (bodyErr) {
          return Response.json({ message: bodyErr.message }, { status: 400 });
        }

        if (queryErr) {
          return Response.json({ message: queryErr.message }, { status: 400 });
        }

        if (headersErr) {
          return Response.json(
            { message: headersErr.message },
            { status: 400 },
          );
        }

        if (cookiesErr) {
          return Response.json(
            { message: cookiesErr.message },
            { status: 400 },
          );
        }

        const ctx = this.createContext({
          request: req,
          validatedBody,
          validatedQuery,
          validatedHeaders,
          validatedCookies,
        });

        return handler(ctx);
      };
    }

    return bunRoutes;
  }

  public defineRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
  >(config: RouteConfig<TReq, TRes>) {
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
