import { ParseError, ValidationError } from "./errors.js";
import type { Middleware } from "./middleware.js";
import type {
  InternalContext,
  RequestSchema,
  ResolvedValidation,
  ResponseSchema,
  ValidatedRequest,
  ValidationOptions,
} from "./types.js";
import { validateSchema } from "./validate.js";

const htmlHeaders = { "Content-Type": "text/html" };
const badRequestInit = { status: 400 };

export const applyHeaders = (c: InternalContext, res: Response) => {
  if (!c.responseHeaders) return res;

  for (const [key, value] of c.responseHeaders) {
    res.headers.set(key, value);
  }

  return res;
};

export const json = (status: number, data: unknown) => {
  if (status === 200) return Response.json(data);

  return Response.json(data, { status });
};

export const text = (status: number, body: string) => {
  if (status === 200) return new Response(body);

  return new Response(body, { status });
};

export const html = (status: number, body: string) => {
  return new Response(body, {
    status,
    headers: htmlHeaders,
  });
};

export const redirect = (status: number, url: string) => {
  return Response.redirect(url, status);
};

export const badRequest = (message?: string) => {
  return Response.json({ message }, badRequestInit);
};

export const mapValidationError = (error: Error) => {
  if (error instanceof ValidationError) return badRequest(error.message);
  if (error instanceof ParseError) return badRequest(error.message);

  throw error;
};

export const validatingJson = (responseSchema: ResponseSchema) => {
  return (status: number, data: unknown) => {
    const schema = responseSchema[status];

    if (!schema) return json(status, data);

    try {
      validateSchema(schema, data);
    } catch (error) {
      return mapValidationError(error as Error);
    }

    return json(status, data);
  };
};

export const emptyValidated: ValidatedRequest = Object.freeze({
  body: undefined,
  query: undefined,
  headers: undefined,
  cookies: undefined,
  params: undefined,
});

const sharedContext = {
  req: emptyValidated,
  get: () => {
    return undefined;
  },
  header(this: InternalContext, name: string, value: string) {
    if (!this.responseHeaders) {
      this.responseHeaders = new Headers();
    }

    this.responseHeaders.set(name, value);
  },
  json,
  text,
  html,
  redirect,
};

export const createContext = (
  req: Bun.BunRequest,
  validated?: ValidatedRequest,
  get?: (key: string) => unknown,
  jsonHandler?: (status: number, data: unknown) => Response,
): InternalContext => {
  const context = Object.create(sharedContext) as InternalContext;
  context.raw = req;

  if (validated) {
    context.req = validated;
  }

  if (get) {
    context.get = get;
  }

  if (jsonHandler) {
    context.json = jsonHandler;
  }

  return context;
};

const stripTrailingSlash = (path: string) => {
  if (path !== "/" && path.endsWith("/")) return path.slice(0, -1);

  return path;
};

export const getFullPath = (input: { prefix?: string; path: string }) => {
  const normalizedPath = stripTrailingSlash(input.path) || "/";

  if (!input.prefix) return normalizedPath;

  const normalizedPrefix = stripTrailingSlash(input.prefix);

  if (normalizedPrefix === "/") return normalizedPath;
  if (normalizedPath === "/") return normalizedPrefix;

  return normalizedPrefix + normalizedPath;
};

export const bodyHasMultipleReaders = (input: {
  middlewares: readonly Middleware[];
  request?: RequestSchema;
}) => {
  let readers = 0;

  if (input.request?.body !== undefined) {
    readers++;
  }

  for (const middleware of input.middlewares) {
    if (middleware.options.request?.body === undefined) continue;

    readers++;

    if (readers > 1) return true;
  }

  return false;
};

export const resolveValidation = (
  options?: ValidationOptions,
): ResolvedValidation => {
  if (options === undefined || options === true)
    return { input: true, output: true };

  if (options === false) return { input: false, output: false };

  return {
    input: options.input !== false,
    output: options.output !== false,
  };
};
