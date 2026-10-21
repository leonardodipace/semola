import { ApiClientError } from "./errors.js";
import type {
  ApiClientOptions,
  ClientCallInput,
  ClientRoute,
  InferApiClient,
  RequestSchema,
} from "./types.js";

const PATH_PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

const isClientRoute = (value: unknown) => {
  if (!value) return false;

  if (typeof value !== "object") return false;

  return (value as ClientRoute).__kind === "semola.api.route";
};

const stripTrailingSlashes = (value: string) => {
  let end = value.length;

  while (end > 0) {
    if (value[end - 1] !== "/") break;

    end -= 1;
  }

  return value.slice(0, end);
};

const fillPath = (template: string, params?: Record<string, unknown>) => {
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

const appendQueryValue = (url: URL, key: string, value: unknown) => {
  if (value === undefined) return;

  if (value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined) continue;

      if (item === null) continue;

      url.searchParams.append(key, String(item));
    }

    return;
  }

  url.searchParams.set(key, String(value));
};

const callRoute = async (
  route: ClientRoute,
  input: ClientCallInput<RequestSchema> | undefined,
  options: ApiClientOptions,
) => {
  const path = fillPath(
    route.getPath(),
    input?.params as Record<string, unknown> | undefined,
  );
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${stripTrailingSlashes(options.baseUrl)}${suffix}`);

  for (const [key, value] of Object.entries(input?.query ?? {})) {
    appendQueryValue(url, key, value);
  }

  const headers = new Headers(options.headers);

  for (const [key, value] of Object.entries(input?.headers ?? {})) {
    if (value === undefined) continue;

    if (value === null) continue;

    headers.set(key, String(value));
  }

  const init: RequestInit = { method: route.method, headers };

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
  options: ApiClientOptions,
): unknown => {
  if (isClientRoute(node)) {
    return (input?: ClientCallInput<RequestSchema>) =>
      callRoute(node as ClientRoute, input, options);
  }

  if (!node) return undefined;

  if (typeof node !== "object") return undefined;

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;

        return createRouterProxy(
          (node as Record<string, unknown>)[prop],
          options,
        );
      },
    },
  );
};

export type ApiClient<TRouter = unknown> = InferApiClient<TRouter>;

export const ApiClient = <TRouter>(
  options: ApiClientOptions<TRouter>,
): ApiClient<TRouter> => {
  return createRouterProxy(options.router, options) as ApiClient<TRouter>;
};
