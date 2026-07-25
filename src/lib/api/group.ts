import type { Middleware } from "./middleware.js";
import { getFullPath } from "./runtime.js";
import type {
  Context,
  GroupOptions,
  RequestSchema,
  ResponseSchema,
  RouteConfig,
  SSEContext,
  SSEEvent,
  SSERouteConfig,
  SSERouteHandler,
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

const formatSSEEvent = (event: SSEEvent) => {
  let message = "";

  if (event.event !== undefined) message += `event: ${event.event}\n`;
  if (event.id !== undefined) message += `id: ${event.id}\n`;
  if (event.retry !== undefined) message += `retry: ${event.retry}\n`;

  const data =
    typeof event.data === "string" ? event.data : JSON.stringify(event.data);

  for (const line of data.split("\n")) {
    message += `data: ${line}\n`;
  }

  return `${message}\n`;
};

const toSSEResponse = (
  handler: SSERouteHandler,
  c: Pick<Context, "raw" | "req" | "get">,
) => {
  const gen = handler(c as SSEContext);
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async pull(controller) {
        const { value, done } = await gen.next();

        if (done) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(formatSSEEvent(value)));
      },
      cancel() {
        void gen.return(undefined);
      },
    }),
    {
      headers: [
        ["Content-Type", "text/event-stream"],
        ["Cache-Control", "no-cache"],
        ["Connection", "keep-alive"],
      ],
    },
  );
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

  public defineSSERoute<
    TReq extends RequestSchema = RequestSchema,
    TRouteMiddlewares extends readonly Middleware[] = readonly [],
  >(config: SSERouteConfig<TReq, TMiddlewares, TRouteMiddlewares>) {
    this.defineRoute({
      path: config.path,
      method: "GET",
      request: config.request,
      middlewares: config.middlewares,
      summary: config.summary,
      description: config.description,
      operationId: config.operationId,
      tags: config.tags,
      handler: (c) => toSSEResponse(config.handler as SSERouteHandler, c),
    });
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
