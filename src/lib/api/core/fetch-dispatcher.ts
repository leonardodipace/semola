import type { ApiRequest, BunRouteHandler, MethodRoutes } from "./types.js";

type HTTPMethod = Bun.Serve.HTTPMethod;
type RouteMethods = Partial<Record<HTTPMethod, BunRouteHandler>>;
type CompiledSegment = {
  value: string;
  paramName?: string;
};
type DynamicRoute = {
  segments: CompiledSegment[];
  methods: RouteMethods;
  paramStarts: number[];
  paramEnds: number[];
};
type PatternRoute = {
  pattern: URLPattern;
  methods: RouteMethods;
};

const notFoundInit = { status: 404 };

const compileDynamicRoute = (path: string, methods: RouteMethods) => {
  const rawSegments = path.split("/").slice(1);
  const segments: CompiledSegment[] = [];
  let paramCount = 0;

  for (const segment of rawSegments) {
    if (segment.startsWith(":")) {
      segments.push({ value: "", paramName: segment.slice(1) });
      paramCount++;
      continue;
    }

    segments.push({ value: segment });
  }

  return {
    segments,
    methods,
    paramStarts: new Array<number>(paramCount),
    paramEnds: new Array<number>(paramCount),
  };
};

const matchDynamicRoute = (route: DynamicRoute, pathname: string) => {
  let pathIndex = 1;
  let paramIndex = 0;

  if (pathname === "/") return route.segments.length === 0;

  for (const segment of route.segments) {
    const nextSlash = pathname.indexOf("/", pathIndex);
    let segmentEnd = pathname.length;

    if (nextSlash !== -1) {
      segmentEnd = nextSlash;
    }

    if (segment.paramName) {
      if (segmentEnd === pathIndex) return false;

      route.paramStarts[paramIndex] = pathIndex;
      route.paramEnds[paramIndex] = segmentEnd;
      paramIndex++;
    } else {
      const segmentLength = segmentEnd - pathIndex;

      if (segment.value.length !== segmentLength) return false;

      if (!pathname.startsWith(segment.value, pathIndex)) return false;
    }

    if (nextSlash === -1) {
      pathIndex = pathname.length;
    } else {
      pathIndex = nextSlash + 1;
    }
  }

  return pathIndex === pathname.length;
};

const assignParams = (route: DynamicRoute, pathname: string) => {
  const params: Record<string, string> = {};
  let paramIndex = 0;

  for (const segment of route.segments) {
    if (!segment.paramName) {
      continue;
    }

    params[segment.paramName] = pathname.slice(
      route.paramStarts[paramIndex],
      route.paramEnds[paramIndex],
    );
    paramIndex++;
  }

  return params;
};

// node:url only exposes `new URL()` or deprecated `url.parse()` - both allocate.
// Slice the path section directly on the hot path.
const pathnameFromRequestUrl = (url: string) => {
  const schemeEnd = url.indexOf("://");
  const pathStart = url.indexOf("/", schemeEnd + 3);

  if (pathStart === -1) return "/";

  const query = url.indexOf("?", pathStart);

  let pathname: string;

  if (query === -1) {
    pathname = url.slice(pathStart);
  } else {
    pathname = url.slice(pathStart, query);
  }

  if (pathname.length > 1 && pathname.endsWith("/"))
    return pathname.slice(0, -1);

  return pathname;
};

export const buildFetchDispatcher = (bunRoutes: MethodRoutes) => {
  const staticRoutes: Record<string, RouteMethods> = Object.create(null);
  const dynamicRoutes: DynamicRoute[] = [];
  const patternRoutes: PatternRoute[] = [];

  for (const [path, methods] of Object.entries(bunRoutes)) {
    const handlers = methods as RouteMethods;

    if (path.includes("*")) {
      patternRoutes.push({
        pattern: new URLPattern({ pathname: path }),
        methods: handlers,
      });

      continue;
    }

    if (path.includes(":")) {
      dynamicRoutes.push(compileDynamicRoute(path, handlers));

      continue;
    }

    staticRoutes[path] = handlers;
  }

  return (req: Request): Response | Promise<Response> => {
    const pathname = pathnameFromRequestUrl(req.url);
    const method = req.method as HTTPMethod;
    const staticHandler = staticRoutes[pathname]?.[method];

    if (staticHandler) return staticHandler(req as Bun.BunRequest);

    for (const route of dynamicRoutes) {
      if (!matchDynamicRoute(route, pathname)) {
        continue;
      }

      const handler = route.methods[method];

      if (!handler) {
        continue;
      }

      (req as ApiRequest).params = assignParams(route, pathname);

      return handler(req as Bun.BunRequest);
    }

    for (const route of patternRoutes) {
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

    return new Response("Not found", notFoundInit);
  };
};
