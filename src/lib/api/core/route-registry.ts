import type { Middleware } from "../middleware/index.js";
import { RouteHandlerBuilder } from "./route-handler-builder.js";
import type {
  MethodRoutes,
  RequestSchema,
  ResolvedValidation,
  ResponseSchema,
  RouteConfig,
} from "./types.js";
import { getFullPath } from "./utils.js";

export class RouteRegistry {
  private routes: RouteConfig<
    RequestSchema,
    ResponseSchema,
    readonly Middleware[],
    readonly Middleware[]
  >[] = [];
  private prefix?: string;
  private handlerBuilder = new RouteHandlerBuilder();

  public constructor(input: { prefix?: string }) {
    this.prefix = input.prefix;
  }

  public addRoute<
    TReq extends RequestSchema = RequestSchema,
    TRes extends ResponseSchema = ResponseSchema,
    TGlobal extends readonly Middleware[] = readonly [],
    TRoute extends readonly Middleware[] = readonly [],
  >(config: RouteConfig<TReq, TRes, TGlobal, TRoute>) {
    this.routes.push(
      config as RouteConfig<
        RequestSchema,
        ResponseSchema,
        readonly Middleware[],
        readonly Middleware[]
      >,
    );
  }

  public getRoutes() {
    return this.routes;
  }

  public buildRoutes(input: {
    globalMiddlewares?: readonly Middleware[];
    validation: ResolvedValidation;
  }): MethodRoutes {
    const bunRoutes: MethodRoutes = {};

    for (const route of this.routes) {
      const fullPath = getFullPath({ prefix: this.prefix, path: route.path });

      if (!bunRoutes[fullPath]) {
        bunRoutes[fullPath] = {};
      }

      bunRoutes[fullPath][route.method] = this.handlerBuilder.build({
        route,
        globalMiddlewares: input.globalMiddlewares ?? [],
        validation: input.validation,
      });
    }

    return bunRoutes;
  }
}
