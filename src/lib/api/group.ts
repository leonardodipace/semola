import type { Middleware } from "./middleware.js";
import { getFullPath } from "./runtime.js";
import type {
  GroupOptions,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
} from "./types.js";

const emptyMiddlewares: readonly Middleware[] = [];

type InternalRouteConfig = RouteConfig<
  RequestSchema,
  ResponseSchema,
  readonly Middleware[],
  readonly Middleware[]
>;

const combineMiddlewares = (
  base: readonly Middleware[] | undefined,
  local: readonly Middleware[] | undefined,
) => {
  if (!base?.length) return local ?? emptyMiddlewares;
  if (!local?.length) return base;

  return [...base, ...local];
};

const combinePrefix = (base: string | undefined, local: string | undefined) => {
  if (!base) return local;
  if (!local) return base;

  return getFullPath({ prefix: base, path: local });
};

export class Group<TMiddlewares extends readonly Middleware[] = readonly []> {
  protected options: GroupOptions<TMiddlewares>;
  protected routes: InternalRouteConfig[] = [];
  protected groups: Group<readonly Middleware[]>[] = [];
  private parent?: Group<readonly Middleware[]>;

  public constructor(options: GroupOptions<TMiddlewares> = {}) {
    this.options = options;
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
        readonly Middleware[],
        readonly Middleware[]
      >,
    );
    this.onRoutesChanged();
  }

  public mount(group: Group<readonly Middleware[]>) {
    group.parent = this;
    this.groups.push(group);
    this.onRoutesChanged();
  }

  protected onRoutesChanged() {
    this.parent?.onRoutesChanged();
  }

  protected collectRoutes(
    prefix: string | undefined = this.options.prefix,
    inheritedMiddlewares: readonly Middleware[] = emptyMiddlewares,
  ): InternalRouteConfig[] {
    const localMiddlewares = combineMiddlewares(
      inheritedMiddlewares,
      this.options.middlewares,
    );
    const collected: InternalRouteConfig[] = this.routes.map((route) => {
      return {
        ...route,
        path: getFullPath({ prefix, path: route.path }),
        middlewares: combineMiddlewares(localMiddlewares, route.middlewares),
      };
    });

    for (const group of this.groups) {
      const nested = group.collectRoutes(
        combinePrefix(prefix, group.options.prefix),
        localMiddlewares,
      );
      collected.push(...nested);
    }

    return collected;
  }
}
