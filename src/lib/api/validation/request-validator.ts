import type { RequestSchema, ValidatedRequest } from "../core/types.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
} from "./index.js";
import type { RequestValidator, ValidateRequestInput } from "./types.js";

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

export const validateRequestOnly = async (input: ValidateRequestInput) => {
  const schema = input.schema;

  if (!schema) return;

  try {
    if (schema.body) {
      await validateBody(input.req, schema.body, input.bodyCache);
    }

    if (schema.query) {
      validateQuery(input.req, schema.query);
    }

    if (schema.headers) {
      validateHeaders(input.req, schema.headers);
    }

    if (schema.cookies) {
      validateCookies(input.req, schema.cookies);
    }

    if (schema.params) {
      validateParams(input.req, schema.params);
    }
  } catch (error) {
    return error as Error;
  }
};

export const buildRequestValidator = (
  schema?: RequestSchema,
): RequestValidator | undefined => {
  if (!schema) return;

  if (
    schema.body &&
    !schema.query &&
    !schema.headers &&
    !schema.cookies &&
    !schema.params
  ) {
    const bodySchema = schema.body;

    return async (req, bodyCache) => {
      try {
        await validateBody(req, bodySchema, bodyCache);
      } catch (error) {
        return error as Error;
      }
    };
  }

  return (req, bodyCache) => {
    return validateRequestOnly({ req, schema, bodyCache });
  };
};

export const validateRequest = async (input: ValidateRequestInput) => {
  const schema = input.schema;

  if (!schema) return { success: true as const, data: {} };

  const data: ValidatedRequest = {};
  const error = await validateRequestInto(input, data);

  if (error) return { success: false as const, error };

  return { success: true as const, data };
};
