import type { Middleware } from "../middleware/index.js";
import type {
  RequestSchema,
  ResolvedValidation,
  ValidationOptions,
} from "./types.js";

export const stripTrailingSlash = (path: string) => {
  if (path !== "/" && path.endsWith("/")) {
    return path.slice(0, -1);
  }

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

export const hasRequestSchemas = (schema?: RequestSchema) => {
  if (!schema) return false;
  if (schema.body) return true;
  if (schema.query) return true;
  if (schema.headers) return true;
  if (schema.cookies) return true;
  if (schema.params) return true;

  return false;
};

const validatesBody = (schema?: RequestSchema) => {
  if (schema?.body === undefined) {
    return false;
  }

  return true;
};

export const bodyHasMultipleReaders = (input: {
  middlewares: Middleware[];
  request?: RequestSchema;
}) => {
  let readers = 0;

  if (validatesBody(input.request)) {
    readers++;
  }

  for (const middleware of input.middlewares) {
    if (validatesBody(middleware.options.request)) {
      readers++;
    }
  }

  return readers > 1;
};

export const resolveValidation = (
  options?: ValidationOptions,
): ResolvedValidation => {
  if (options === undefined || options === true) {
    return { input: true, output: true };
  }

  if (options === false) {
    return { input: false, output: false };
  }

  return {
    input: options.input !== false,
    output: options.output !== false,
  };
};
