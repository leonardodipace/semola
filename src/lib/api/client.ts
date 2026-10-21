import { ApiClientError } from "./errors.js";
import type {
  ApiClientOptions,
  ClientCallInput,
  ClientRoute,
  InferApiClient,
  RequestSchema,
  ResponseSchema,
} from "./types.js";

const PATH_PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;
const ROUTE_KIND = "semola.api.route";

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

const resolveUrl = (baseUrl: string, path: string) => {
  const url = new URL(baseUrl);
  const prefix = url.pathname.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;

  if (suffix === "/") {
    url.pathname = prefix || "/";
  } else {
    url.pathname = `${prefix}${suffix}`;
  }

  return url;
};

const callRoute = async (
  route: ClientRoute<RequestSchema | undefined, ResponseSchema | undefined>,
  input: ClientCallInput<RequestSchema> | undefined,
  options: ApiClientOptions<unknown>,
) => {
  const url = resolveUrl(
    options.baseUrl,
    fillPath(route.getPath(), input?.params as Record<string, unknown>),
  );

  for (const [key, value] of Object.entries(input?.query ?? {})) {
    if (value === undefined) continue;

    if (value === null) continue;

    url.searchParams.set(key, String(value));
  }

  const headers = new Headers(options.headers);

  for (const [key, value] of Object.entries(input?.headers ?? {})) {
    headers.set(key, value);
  }

  const init: RequestInit = {
    method: route.method,
    headers,
  };

  if (input?.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(input.body);
  }

  const response = await (options.fetch ?? fetch)(url, init);
  const text = await response.text();
  let body: unknown;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new ApiClientError(
      `Request failed with status ${response.status}`,
      response.status,
      body,
    );
  }

  return body;
};

const createRouterProxy = (
  node: unknown,
  options: ApiClientOptions<unknown>,
): unknown => {
  if (
    node &&
    typeof node === "object" &&
    (node as ClientRoute).__kind === ROUTE_KIND
  ) {
    const route = node as ClientRoute<
      RequestSchema | undefined,
      ResponseSchema | undefined
    >;

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

export const ApiClient = function ApiClient<TRouter>(
  options: ApiClientOptions<TRouter>,
): ApiClient<TRouter> {
  return createRouterProxy(options.router, options) as ApiClient<TRouter>;
} as unknown as {
  new <TRouter>(options: ApiClientOptions<TRouter>): ApiClient<TRouter>;
};
