import type { Middleware } from "../middleware/index.js";
import { generateOpenApiSpec } from "../openapi/index.js";
import { buildFetchDispatcher } from "./fetch-dispatcher.js";
import { RouteRegistry } from "./route-registry.js";
import type {
  ApiOptions,
  MethodRoutes,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
} from "./types.js";
import { resolveValidation } from "./utils.js";

export class Api<TMiddlewares extends readonly Middleware[] = readonly []> {
  private options: ApiOptions<TMiddlewares>;
  private registry: RouteRegistry;
  private routesDirty = true;
  private compiled?: {
    routes: MethodRoutes;
    fetch: (req: Request) => Response | Promise<Response>;
  };

  public constructor(options: ApiOptions<TMiddlewares> = {}) {
    this.options = options;
    this.registry = new RouteRegistry({ prefix: options.prefix });
  }

  public defineRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TRouteMiddlewares extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TMiddlewares, TRouteMiddlewares>) {
    this.registry.addRoute(config);
    this.routesDirty = true;
  }

  public fetch(req: Request) {
    return this.ensureCompiled().fetch(req);
  }

  public getRouteHandlers() {
    return this.ensureCompiled().routes;
  }

  public getOpenApiSpec() {
    return generateOpenApiSpec({
      title: this.options.openapi?.title ?? "API",
      description: this.options.openapi?.description,
      version: this.options.openapi?.version ?? "1.0.0",
      prefix: this.options.prefix,
      servers: this.options.openapi?.servers,
      securitySchemes: this.options.openapi?.securitySchemes,
      routes: this.registry.getRoutes(),
      globalMiddlewares: this.options.middlewares,
    });
  }

  public serve(port: number, callback?: (server: Bun.Server<unknown>) => void) {
    const server = Bun.serve({
      port,
      routes: this.getRouteHandlers(),
      fetch: () => new Response("Not found", { status: 404 }),
    });

    if (callback) {
      callback(server);
    }
  }

  private ensureCompiled() {
    if (!this.routesDirty && this.compiled) {
      return this.compiled;
    }

    const routes = this.registry.buildRoutes({
      globalMiddlewares: this.options.middlewares,
      validation: resolveValidation(this.options.validation),
    });

    this.compiled = {
      routes,
      fetch: buildFetchDispatcher(routes),
    };

    this.routesDirty = false;

    return this.compiled;
  }
}
