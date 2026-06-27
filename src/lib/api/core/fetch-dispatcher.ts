import type { ApiRequest, BunRouteHandler, MethodRoutes } from "./types.js";
import { stripTrailingSlash } from "./utils.js";

type HTTPMethod = Bun.Serve.HTTPMethod;
type RouteMethods = Partial<Record<HTTPMethod, BunRouteHandler>>;

// node:url only exposes `new URL()` or deprecated `url.parse()` - both allocate.
// Slice the path section directly on the hot path.
const pathnameFromRequestUrl = (url: string) => {
  const schemeEnd = url.indexOf("://");
  const pathStart = url.indexOf("/", schemeEnd + 3);

  if (pathStart === -1) {
    return "/";
  }

  const query = url.indexOf("?", pathStart);

  let pathname: string;

  if (query === -1) {
    pathname = url.slice(pathStart);
  } else {
    pathname = url.slice(pathStart, query);
  }

  const normalized = stripTrailingSlash(pathname);

  if (!normalized) return "/";

  return normalized;
};

export const buildFetchDispatcher = (bunRoutes: MethodRoutes) => {
  const staticRoutes = new Map<string, RouteMethods>();
  const dynamicRoutes: Array<{
    pattern: URLPattern;
    methods: RouteMethods;
  }> = [];

  for (const [path, methods] of Object.entries(bunRoutes)) {
    const handlers = methods as RouteMethods;

    if (/[:*]/.test(path)) {
      dynamicRoutes.push({
        pattern: new URLPattern({ pathname: path }),
        methods: handlers,
      });

      continue;
    }

    staticRoutes.set(path, handlers);
  }

  return (req: Request): Response | Promise<Response> => {
    const pathname = pathnameFromRequestUrl(req.url);
    const method = req.method as HTTPMethod;
    const staticHandler = staticRoutes.get(pathname)?.[method];

    if (staticHandler) {
      return staticHandler(req as Bun.BunRequest);
    }

    for (const route of dynamicRoutes) {
      const match = route.pattern.exec({ pathname });

      if (!match) {
        continue;
      }

      const handler = route.methods[method];

      if (!handler) {
        continue;
      }

      (req as ApiRequest).params = match.pathname.groups as Record<
        string,
        string
      >;

      return handler(req as Bun.BunRequest);
    }

    return new Response("Not found", { status: 404 });
  };
};
