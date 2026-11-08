import { stripTrailingSlash } from "./runtime.js";
import type {
  ApiRequest,
  CompiledSegment,
  DynamicRoute,
  HTTPMethod,
  MethodRoutes,
  ParamRoute,
  PatternRoute,
  RouteMethods,
} from "./types.js";
import { decodePart } from "./validate.js";

const notFoundInit = { status: 404 };

const compileDynamicRoute = (path: string, methods: RouteMethods) => {
  const rawSegments = path.split("/").slice(1);
  const segments: CompiledSegment[] = [];
  let paramCount = 0;

  for (const segment of rawSegments) {
    if (segment.startsWith(":")) {
      segments.push({ value: "", paramName: decodePart(segment.slice(1)) });
      paramCount++;
      continue;
    }

    segments.push({ value: segment });
  }

  const route: DynamicRoute = {
    kind: "dynamic",
    segments,
    methods,
    paramStarts: new Array<number>(paramCount),
    paramEnds: new Array<number>(paramCount),
  };

  return route;
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

    // Decode like Bun's native router, so params match getRouteHandlers().
    params[segment.paramName] = decodePart(
      pathname.slice(
        route.paramStarts[paramIndex],
        route.paramEnds[paramIndex],
      ),
    );
    paramIndex++;
  }

  return params;
};

// ":name" captures one segment and "*" captures the rest. As in dynamic routes,
// a param starts a segment and its name runs to the segment's end, so
// "/things:batch" stays literal. Replaces URLPattern, which Node only ships
// from version 24.
const PATTERN_TOKEN = /(?<=\/):([^/*]+)|\*/g;
const REGEX_SPECIAL = /[.+?^${}()|[\]\\]/g;

const escapeRegex = (literal: string) => {
  return literal.replace(REGEX_SPECIAL, "\\$&");
};

const compilePatternRoute = (path: string, methods: RouteMethods) => {
  const paramNames: string[] = [];
  let source = "";
  let literalStart = 0;
  let wildcardCount = 0;

  for (const match of path.matchAll(PATTERN_TOKEN)) {
    const [token, name] = match;

    source += escapeRegex(path.slice(literalStart, match.index));
    literalStart = match.index + token.length;

    if (name) {
      paramNames.push(decodePart(name));
      source += "([^/]+)";
      continue;
    }

    // Unnamed wildcards are numbered from 0, as URLPattern groups were.
    paramNames.push(String(wildcardCount));
    wildcardCount++;
    source += "(.*)";
  }

  source += escapeRegex(path.slice(literalStart));

  const route: PatternRoute = {
    kind: "pattern",
    regex: new RegExp(`^${source}$`),
    paramNames,
    methods,
  };

  return route;
};

// Bun's router prefers the most specific route. Per segment, a literal beats
// ":param", which beats "*". When one path's ranks are a prefix of the other's,
// the shorter goes first. Equal ranks keep registration order (stable sort).
const LITERAL_RANK = 0;
const PARAM_RANK = 1;
const WILDCARD_RANK = 2;

const rankSegment = (segment: string) => {
  if (segment.includes("*")) return WILDCARD_RANK;
  if (segment.startsWith(":")) return PARAM_RANK;

  return LITERAL_RANK;
};

const rankPath = (path: string) => {
  return path.split("/").map(rankSegment);
};

const compareRanks = (a: number[], b: number[]) => {
  for (const [index, aRank] of a.entries()) {
    const bRank = b[index];

    if (bRank === undefined) break;
    if (aRank !== bRank) return aRank - bRank;
  }

  return a.length - b.length;
};

// Request pathnames arrive percent-encoded, so encode route paths ("/café",
// "/a b") the same way a URL does. Prefix instead of resolving, so "//a" stays
// a path and not a host.
const encodeRoutePath = (routePath: string) => {
  return new URL(`http://localhost${routePath}`).pathname;
};

const readPatternParams = (route: PatternRoute, match: RegExpExecArray) => {
  const params: Record<string, string> = {};

  for (const [index, name] of route.paramNames.entries()) {
    params[name] = decodePart(match[index + 1] ?? "");
  }

  return params;
};

// Wildcards match the raw pathname, so "/files/*" matches "/files/" but not
// "/files", like Bun's router (unless a static "/files" route claims the
// slash-stripped path first). Dynamic routes ignore a trailing slash.
const matchParamRoute = (
  route: ParamRoute,
  pathname: string,
  rawPathname: string,
) => {
  if (route.kind === "dynamic") {
    if (!matchDynamicRoute(route, pathname)) return;

    return assignParams(route, pathname);
  }

  const match = route.regex.exec(rawPathname);

  if (!match) return;

  return readPatternParams(route, match);
};

const PATH_END = /[?#]/;

const pathnameFromRequestUrl = (url: string) => {
  const schemeEnd = url.indexOf("://");
  const pathStart = url.indexOf("/", schemeEnd + 3);

  if (pathStart === -1) return "/";

  // The path ends at the query or, in a Request built with one, the fragment.
  const pathEnd = url.search(PATH_END);

  if (pathEnd === -1) return url.slice(pathStart);

  return url.slice(pathStart, pathEnd);
};

export const buildFetchDispatcher = (routes: MethodRoutes) => {
  const staticRoutes: Record<string, RouteMethods> = Object.create(null);
  const rankedRoutes: [ParamRoute, number[]][] = [];

  for (const [routePath, routeMethods] of Object.entries(routes)) {
    const path = encodeRoutePath(routePath);

    // Like Bun's router: match the path first, then answer HEAD with that
    // route's GET unless it defines HEAD. Servers drop the body.
    // No prototype, so a request method like "constructor" finds nothing.
    const methods: RouteMethods = Object.assign(
      Object.create(null),
      routeMethods,
    );
    methods.HEAD ??= routeMethods.GET;

    if (path.includes("*")) {
      rankedRoutes.push([compilePatternRoute(path, methods), rankPath(path)]);

      continue;
    }

    if (path.includes(":")) {
      rankedRoutes.push([compileDynamicRoute(path, methods), rankPath(path)]);

      continue;
    }

    staticRoutes[path] = methods;
  }

  // One list in specificity order, so a literal wildcard route can beat a
  // ":param" route that would also match. Static routes are looked up by path.
  rankedRoutes.sort(([, a], [, b]) => compareRanks(a, b));

  const paramRoutes = rankedRoutes.map(([route]) => route);

  return (req: ApiRequest) => {
    const rawPathname = pathnameFromRequestUrl(req.url);
    const pathname = stripTrailingSlash(rawPathname);
    const method = req.method as HTTPMethod;
    const staticHandler = staticRoutes[pathname]?.[method];

    if (staticHandler) return staticHandler(req);

    for (const route of paramRoutes) {
      // Method first: skipping a route that lacks it gives the same result as
      // matching its path, and costs no match or params.
      const handler = route.methods[method];

      if (!handler) {
        continue;
      }

      const params = matchParamRoute(route, pathname, rawPathname);

      if (!params) {
        continue;
      }

      req.params = params;

      return handler(req);
    }

    return new Response("Not found", notFoundInit);
  };
};
