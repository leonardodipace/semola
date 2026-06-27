import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ParseError, ValidationError } from "../errors.js";

const formatIssues = (
  issues: NonNullable<
    Awaited<ReturnType<StandardSchemaV1["~standard"]["validate"]>>["issues"]
  >,
) => {
  const messages = issues.map((issue) => {
    let path = "unknown";

    if (Array.isArray(issue.path)) {
      path = issue.path.map(String).join(".");
    }

    return `${path}: ${issue.message ?? "validation failed"}`;
  });

  return messages.join(", ");
};

const processResult = <T>(
  result: Awaited<ReturnType<StandardSchemaV1["~standard"]["validate"]>>,
) => {
  if (!result.issues) {
    return result.value as T;
  }

  throw new ValidationError(formatIssues(result.issues));
};

export const validateSchema = <T>(
  schema: StandardSchemaV1,
  data: unknown,
): T | Promise<T> => {
  const output = schema["~standard"].validate(data);

  if (output instanceof Promise) {
    return output.then((result) => processResult<T>(result));
  }

  return processResult<T>(output);
};

export type BodyCache = { parsed: boolean; value: unknown };

// Body cache prevents re-parsing JSON when multiple middlewares validate the same body
export const validateBody = async (
  req: Request,
  bodySchema?: StandardSchemaV1,
  bodyCache?: BodyCache,
) => {
  if (!bodySchema) {
    return true;
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return undefined;
  }

  if (bodyCache?.parsed) {
    return validateSchema(bodySchema, bodyCache.value);
  }

  let parsedBody: unknown;

  try {
    parsedBody = await req.json();
  } catch {
    throw new ParseError("Invalid JSON body");
  }

  if (bodyCache) {
    bodyCache.parsed = true;
    bodyCache.value = parsedBody;
  }

  return validateSchema(bodySchema, parsedBody);
};

export const validateQuery = async (
  req: Request,
  querySchema?: StandardSchemaV1,
) => {
  if (!querySchema) {
    return true;
  }

  const qIndex = req.url.indexOf("?");

  if (qIndex === -1) {
    return validateSchema(querySchema, {});
  }

  // Handle both query strings and URL fragments
  const hashIndex = req.url.indexOf("#", qIndex + 1);
  const queryString =
    hashIndex === -1
      ? req.url.slice(qIndex + 1)
      : req.url.slice(qIndex + 1, hashIndex);

  const searchParams = new URLSearchParams(queryString);
  const queryParams: Record<string, string | string[]> = {};

  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);
    const [firstValue] = values;

    if (values.length === 1) {
      queryParams[key] = firstValue as string;
    } else {
      queryParams[key] = values;
    }
  }

  return validateSchema(querySchema, queryParams);
};

export const validateHeaders = async (
  req: Request,
  headersSchema?: StandardSchemaV1,
) => {
  if (!headersSchema) {
    return true;
  }

  const headers: Record<string, string> = {};

  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return validateSchema(headersSchema, headers);
};

export const validateCookies = async (
  req: Request,
  cookiesSchema?: StandardSchemaV1,
) => {
  if (!cookiesSchema) {
    return true;
  }

  // Use Bun's native CookieMap for efficient cookie parsing
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieMap = new Bun.CookieMap(cookieHeader);
  const cookies = Object.fromEntries(cookieMap);

  return validateSchema(cookiesSchema, cookies);
};

export const validateParams = async (
  req: Bun.BunRequest,
  paramsSchema?: StandardSchemaV1,
) => {
  if (!paramsSchema) {
    return true;
  }

  return validateSchema(paramsSchema, req.params);
};
