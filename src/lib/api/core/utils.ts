import type { Middleware } from "../middleware/index.js";
import type {
  RequestSchema,
  ResolvedValidation,
  ValidationOptions,
} from "./types.js";

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
