import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type { RequestSchema, ValidatedRequest } from "../core/types.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
} from "./index.js";
import type { ValidateRequestInput } from "./types.js";

type SyncRequestField = "query" | "headers" | "cookies" | "params";

type SyncValidator = {
  field: SyncRequestField;
  validate: (
    req: Bun.BunRequest,
    schema: NonNullable<RequestSchema[SyncRequestField]>,
  ) => unknown;
};

const syncValidators = [
  { field: "query", validate: validateQuery },
  { field: "headers", validate: validateHeaders },
  { field: "cookies", validate: validateCookies },
  { field: "params", validate: validateParams },
] as const satisfies readonly SyncValidator[];

const hasOnlyBodySchema = (schema: RequestSchema) => {
  if (!schema.body) {
    return false;
  }

  if (schema.query) {
    return false;
  }

  if (schema.headers) {
    return false;
  }

  if (schema.cookies) {
    return false;
  }

  if (schema.params) {
    return false;
  }

  return true;
};

export const validateRequest = async (input: ValidateRequestInput) => {
  const schema = input.schema;

  if (!schema) {
    return { success: true as const, data: {} };
  }

  if (hasOnlyBodySchema(schema)) {
    const [error, body] = await mightThrow(
      validateBody(input.req, schema.body, input.bodyCache),
    );

    if (error) {
      return { success: false as const, error };
    }

    return { success: true as const, data: { body } };
  }

  const data: ValidatedRequest = {};

  if (schema.body) {
    const [error, body] = await mightThrow(
      validateBody(input.req, schema.body, input.bodyCache),
    );

    if (error) {
      return { success: false as const, error };
    }

    data.body = body;
  }

  for (const { field, validate } of syncValidators) {
    const fieldSchema = schema[field];

    if (!fieldSchema) {
      continue;
    }

    const [error, value] = mightThrowSync(() => {
      return validate(input.req, fieldSchema);
    });

    if (error) {
      return { success: false as const, error };
    }

    data[field] = value;
  }

  return { success: true as const, data };
};
