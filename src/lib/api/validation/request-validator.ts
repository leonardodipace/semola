import type { ValidatedRequest } from "../core/types.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
} from "./index.js";
import type { ValidateRequestInput } from "./types.js";

export const validateRequestInto = async (
  input: ValidateRequestInput,
  data: ValidatedRequest,
) => {
  const schema = input.schema;

  if (!schema) return;

  try {
    if (schema.body) {
      data.body = await validateBody(input.req, schema.body, input.bodyCache);
    }

    if (schema.query) {
      data.query = validateQuery(input.req, schema.query);
    }

    if (schema.headers) {
      data.headers = validateHeaders(input.req, schema.headers);
    }

    if (schema.cookies) {
      data.cookies = validateCookies(input.req, schema.cookies);
    }

    if (schema.params) {
      data.params = validateParams(input.req, schema.params);
    }
  } catch (error) {
    return error as Error;
  }
};

export const validateRequest = async (input: ValidateRequestInput) => {
  const schema = input.schema;

  if (!schema) return { success: true as const, data: {} };

  const data: ValidatedRequest = {};
  const error = await validateRequestInto(input, data);

  if (error) return { success: false as const, error };

  return { success: true as const, data };
};
