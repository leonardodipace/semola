import { validateSchema } from "../api/validator.js";
import type {
  Api2Options,
  Context,
  InferInput,
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
} from "./types.js";
import { parseBody } from "./validator.js";

export class Api2 {
  private options: Api2Options;
  private routes: RouteConfig[] = [];

  public constructor(options: Api2Options) {
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
  >(request: Request, validatedBody: InferInput<TReq["body"]>) {
    const ctx: Context<TReq, TRes> = {
      raw: request,
      req: {
        body: validatedBody,
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
        // Parse body if schema is defined
        const [parseError, body] = await parseBody(req, request?.body);

        if (parseError) {
          return Response.json(
            { message: parseError.message },
            { status: 400 },
          );
        }

        if (!request?.body) {
          const ctx = this.createContext(req, undefined);

          return handler(ctx);
        }

        // Validate body if schema is defined
        const [validationError, validatedBody] = await validateSchema(
          request.body,
          body,
        );

        if (validationError) {
          return Response.json(
            { message: validationError.message },
            { status: 400 },
          );
        }

        const ctx = this.createContext(req, validatedBody);

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
