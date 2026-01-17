import type { StandardSchemaV1 } from "@standard-schema/spec";
import { err, mightThrow, ok } from "../errors/index.js";

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

  // Validate the parsed body
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
  const queryParams: Record<string, string[]> = {};

  for (const key of url.searchParams.keys()) {
    queryParams[key] = url.searchParams.getAll(key);
  }

  return validateSchema(querySchema, queryParams);
};
