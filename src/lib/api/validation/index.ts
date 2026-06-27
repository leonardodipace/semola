import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ParseError, ValidationError } from "../errors.js";
import type { BodyCache } from "./types.js";

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

const readValidationResult = <T>(
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
): T => {
  const result = schema["~standard"].validate(data);

  if (result instanceof Promise) {
    throw new ValidationError("Async schema validation is not supported");
  }

  return readValidationResult<T>(result);
};

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

export const validateQuery = (req: Request, querySchema?: StandardSchemaV1) => {
  if (!querySchema) {
    return true;
  }

  const queryStart = req.url.indexOf("?");

  if (queryStart === -1) {
    return validateSchema(querySchema, {});
  }

  const hashStart = req.url.indexOf("#", queryStart + 1);
  let queryString = req.url.slice(queryStart + 1);

  if (hashStart !== -1) {
    queryString = req.url.slice(queryStart + 1, hashStart);
  }

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

export const validateHeaders = (
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

export const validateCookies = (
  req: Request,
  cookiesSchema?: StandardSchemaV1,
) => {
  if (!cookiesSchema) {
    return true;
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieMap = new Bun.CookieMap(cookieHeader);
  const cookies = Object.fromEntries(cookieMap);

  return validateSchema(cookiesSchema, cookies);
};

export const validateParams = (
  req: Bun.BunRequest,
  paramsSchema?: StandardSchemaV1,
) => {
  if (!paramsSchema) {
    return true;
  }

  return validateSchema(paramsSchema, req.params);
};
