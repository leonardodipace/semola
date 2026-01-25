import type { StandardSchemaV1 } from "@standard-schema/spec";
import { err, ok } from "../errors/index.js";
import type { CommonError } from "../errors/types.js";

export type ValidationResult<T> = readonly [
  { type: CommonError; message: string } | null,
  T | null,
];

export const validateSchema = async <T>(
  schema: StandardSchemaV1 | undefined,
  data: unknown,
) => {
  if (!schema) {
    return ok(data as T);
  }

  const result = await schema["~standard"].validate(data);

  if (result.issues) {
    const message = result.issues
      .map((issue) => {
        const path = Array.isArray(issue.path)
          ? issue.path.map(String).join(".")
          : "unknown";
        return `${path}: ${issue.message ?? "validation failed"}`;
      })
      .join(", ");

    return err("ValidationError", message);
  }

  return ok(result.value as T);
};
