import { ApiClientError } from "./errors.js";
import type {
  ApiClientHeaders,
  ApiClientOptions,
  ClientCallInput,
  ClientRoute,
  InferApiClient,
  RequestSchema,
  ResponseSchema,
} from "./types.js";

const PATH_PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

const asClientRoute = (value: unknown) => {
  if (!value) return undefined;

  if (typeof value !== "object") return undefined;

  if ((value as ClientRoute).__kind !== "semola.api.route") return undefined;

  return value as ClientRoute<
    RequestSchema | undefined,
    ResponseSchema | undefined
  >;
};

const joinBaseUrl = (baseUrl: string, path: string) => {
  const base = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedPath === "/") return base || "/";

  return `${base}${normalizedPath}`;
};

const cookieHeader = (cookies: Record<string, unknown> | undefined) => {
  if (!cookies) return undefined;

  const parts: string[] = [];

  for (const [key, value] of Object.entries(cookies)) {
    if (value === undefined) continue;

    if (value === null) continue;

    parts.push(`${key}=${String(value)}`);
  }

  if (parts.length === 0) return undefined;

  return parts.join("; ");
};

const fillPath = (
  template: string,
  params: Record<string, unknown> | undefined,
) => {
  return template.replace(PATH_PARAM, (_match, name: string) => {
    const value = params?.[name];

    if (value === undefined) {
      throw new ApiClientError(`Missing path param: ${name}`, 0, undefined);
    }

    if (value === null) {
      throw new ApiClientError(`Missing path param: ${name}`, 0, undefined);
    }

    return encodeURIComponent(String(value));
  });
};

const appendQuery = (url: URL, query: Record<string, unknown> | undefined) => {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;

    if (value === null) continue;

    url.searchParams.set(key, String(value));
  }
};

const mergeHeaders = (
  base: ApiClientHeaders | undefined,
  extra: Record<string, string> | undefined,
) => {
  const headers = new Headers(base);

  if (!extra) return headers;

  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }

  return headers;
};

const parseResponseBody = async (response: Response) => {
  const text = await response.text();

  if (text.length === 0) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const assertOk = (response: Response, body: unknown) => {
  if (response.ok) return;

  throw new ApiClientError(
    `Request failed with status ${response.status}`,
    response.status,
    body,
  );
};

const callRoute = async (
  route: ClientRoute<RequestSchema | undefined, ResponseSchema | undefined>,
  input: ClientCallInput<RequestSchema> | undefined,
  options: ApiClientOptions<unknown>,
) => {
  const path = fillPath(
    route.getPath(),
    input?.params as Record<string, unknown>,
  );
  const url = new URL(joinBaseUrl(options.baseUrl, path));

  appendQuery(url, input?.query as Record<string, unknown> | undefined);

  const headers = mergeHeaders(
    options.headers,
    input?.headers as Record<string, string> | undefined,
  );

  const cookie = cookieHeader(
    input?.cookies as Record<string, unknown> | undefined,
  );

  if (cookie) {
    headers.set("cookie", cookie);
  }

  const init: RequestInit = {
    method: route.method,
    headers,
  };

  if (input?.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(input.body);
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  const response = await fetchFn(url, init);
  const body = await parseResponseBody(response);

  assertOk(response, body);

  return body;
};

const createRouterProxy = (
  node: unknown,
  options: ApiClientOptions<unknown>,
): unknown => {
  const route = asClientRoute(node);

  if (route) {
    return (input?: ClientCallInput<RequestSchema>) =>
      callRoute(route, input, options);
  }

  if (!node) return undefined;

  if (typeof node !== "object") return undefined;

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;

        const child = (node as Record<string, unknown>)[prop];

        if (child === undefined) return undefined;

        return createRouterProxy(child, options);
      },
    },
  );
};

export type ApiClient<TRouter = unknown> = InferApiClient<TRouter>;

export interface ApiClientConstructor {
  new <TRouter>(options: ApiClientOptions<TRouter>): ApiClient<TRouter>;
  <TRouter>(options: ApiClientOptions<TRouter>): ApiClient<TRouter>;
}

export const ApiClient = function ApiClient<TRouter>(
  options: ApiClientOptions<TRouter>,
): ApiClient<TRouter> {
  return createRouterProxy(options.router, options) as ApiClient<TRouter>;
} as ApiClientConstructor;
