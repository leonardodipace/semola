import type { StandardSchemaV1 } from "@standard-schema/spec";
import { err, mightThrow, ok } from "../../errors/index.js";

export const validateSchema = async <T>(
  schema: StandardSchemaV1,
  data: unknown,
) => {
  const result = await schema["~standard"].validate(data);

  if (!result.issues) {
    return ok(result.value as T);
  }

  const issues = result.issues.map((issue) => {
    let path = "unknown";

    if (Array.isArray(issue.path)) {
      path = issue.path.map(String).join(".");
    }

    return `${path}: ${issue.message ?? "validation failed"}`;
  });

  const message = issues.join(", ");

  return err("ValidationError", message);
};

export const validateBody = async (
  req: Request,
  bodySchema?: StandardSchemaV1,
) => {
  if (!bodySchema) {
    return ok(undefined);
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return ok(undefined);
  }

  const [parseError, parsedBody] = await mightThrow(req.json());

  if (parseError) {
    return err("ParseError", "Invalid JSON body");
  }

  return validateSchema(bodySchema, parsedBody);
};

export const validateQuery = async (
  req: Request,
  querySchema?: StandardSchemaV1,
) => {
  if (!querySchema) {
    return ok(undefined);
  }

  const url = new URL(req.url);
  const queryParams: Record<string, string | string[]> = {};

  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key);
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
    return ok(undefined);
  }

  const headers: Record<string, string> = {};

  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return validateSchema(headersSchema, headers);
};

export const validateCookies = async (
  req: Request,
  cookiesSchema?: StandardSchemaV1,
) => {
  if (!cookiesSchema) {
    return ok(undefined);
  }

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
    return ok(undefined);
  }

  return validateSchema(paramsSchema, req.params);
};
