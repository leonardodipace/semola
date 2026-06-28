import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ApiRequest } from "../core/types.js";
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
  if (!result.issues) return result.value as T;

  throw new ValidationError(formatIssues(result.issues));
};

const decodePart = (value: string, plusAsSpace = false) => {
  let normalized = value;

  if (plusAsSpace && value.includes("+")) {
    normalized = value.replaceAll("+", " ");
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
};

const assignQueryValue = (
  queryParams: Record<string, string | string[]>,
  key: string,
  value: string,
) => {
  const current = queryParams[key];

  if (current === undefined) {
    queryParams[key] = value;
    return;
  }

  if (Array.isArray(current)) {
    current.push(value);
    return;
  }

  queryParams[key] = [current, value];
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
  if (!bodySchema) return true;

  if (bodyCache?.parsed) return validateSchema(bodySchema, bodyCache.value);

  const contentType = req.headers.get("content-type") ?? "";
  let parsedBody: unknown;

  if (contentType.includes("application/json")) {
    try {
      parsedBody = await req.json();
    } catch {
      throw new ParseError("Invalid JSON body");
    }
  } else {
    parsedBody = await req.text();
  }

  if (bodyCache) {
    bodyCache.parsed = true;
    bodyCache.value = parsedBody;
  }

  return validateSchema(bodySchema, parsedBody);
};

export const validateQuery = (req: Request, querySchema?: StandardSchemaV1) => {
  if (!querySchema) return true;

  const queryStart = req.url.indexOf("?");

  if (queryStart === -1) return validateSchema(querySchema, {});

  const hashStart = req.url.indexOf("#", queryStart + 1);
  let queryEnd = req.url.length;

  if (hashStart !== -1) {
    queryEnd = hashStart;
  }

  const queryParams: Record<string, string | string[]> = {};
  let partStart = queryStart + 1;

  while (partStart <= queryEnd) {
    const ampersand = req.url.indexOf("&", partStart);
    let partEnd = queryEnd;

    if (ampersand !== -1 && ampersand < queryEnd) {
      partEnd = ampersand;
    }

    if (partEnd > partStart) {
      const equals = req.url.indexOf("=", partStart);
      const hasEquals = equals !== -1 && equals < partEnd;
      let rawKey = req.url.slice(partStart, partEnd);
      let rawValue = "";

      if (hasEquals) {
        rawKey = req.url.slice(partStart, equals);
        rawValue = req.url.slice(equals + 1, partEnd);
      }

      assignQueryValue(
        queryParams,
        decodePart(rawKey, true),
        decodePart(rawValue, true),
      );
    }

    if (ampersand === -1 || ampersand >= queryEnd) {
      break;
    }

    partStart = ampersand + 1;
  }

  return validateSchema(querySchema, queryParams);
};

export const validateHeaders = (
  req: Request,
  headersSchema?: StandardSchemaV1,
) => {
  if (!headersSchema) return true;

  const headers: Record<string, string> = {};

  for (const [key, value] of req.headers) {
    headers[key] = value;
  }

  return validateSchema(headersSchema, headers);
};

export const validateCookies = (
  req: Request,
  cookiesSchema?: StandardSchemaV1,
) => {
  if (!cookiesSchema) return true;

  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookies: Record<string, string> = {};
  let partStart = 0;

  while (partStart < cookieHeader.length) {
    const semicolon = cookieHeader.indexOf(";", partStart);
    let partEnd = cookieHeader.length;

    if (semicolon !== -1) {
      partEnd = semicolon;
    }

    const equals = cookieHeader.indexOf("=", partStart);
    const hasEquals = equals !== -1 && equals < partEnd;

    if (hasEquals) {
      const key = cookieHeader.slice(partStart, equals).trim();

      if (key) {
        const value = cookieHeader.slice(equals + 1, partEnd).trim();
        cookies[key] = decodePart(value);
      }
    }

    if (semicolon === -1) {
      break;
    }

    partStart = semicolon + 1;
  }

  return validateSchema(cookiesSchema, cookies);
};

export const validateParams = (
  req: ApiRequest,
  paramsSchema?: StandardSchemaV1,
) => {
  if (!paramsSchema) return true;

  return validateSchema(paramsSchema, req.params ?? {});
};
