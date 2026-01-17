import type { StandardSchemaV1 } from "@standard-schema/spec";
import { validateSchema } from "../api/validator.js";
import { mightThrow, ok } from "../errors/index.js";
import type {
  Api2Options,
  Context,
  InferInput,
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
} from "./types.js";

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

  private async parseBody(req: Request, bodySchema?: StandardSchemaV1) {
    if (!bodySchema) {
      return ok(undefined);
    }

    const contentType = req.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      return ok(undefined);
    }

    const [parseError, parsedBody] = await mightThrow(req.json());

    if (parseError) {
      return [
        Response.json({ message: "Invalid JSON body" }, { status: 400 }),
        null,
      ] as const;
    }

    return ok(parsedBody);
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
        const [bodyError, body] = await this.parseBody(req, request?.body);

        if (bodyError) return bodyError;

        // Validate body if schema is defined
        if (request?.body) {
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

          const c = this.createContext(req, validatedBody);
          return handler(c);
        }

        // No body schema - pass undefined
        const c = this.createContext(req, undefined);
        return handler(c);
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
