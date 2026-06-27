import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type { RequestSchema, ValidatedRequest } from "../core/types.js";
import {
  validateBody,
  validateCookies,
  validateHeaders,
  validateParams,
  validateQuery,
} from "./index.js";
import type { ValidateRequestInput, ValidateRequestResult } from "./types.js";

const schemaFields = [
  "body",
  "query",
  "headers",
  "cookies",
  "params",
] as const satisfies readonly (keyof RequestSchema)[];

const syncFieldValidators = {
  query: (input: ValidateRequestInput) => {
    return validateQuery(input.req, input.schema?.query);
  },
  headers: (input: ValidateRequestInput) => {
    return validateHeaders(input.req, input.schema?.headers);
  },
  cookies: (input: ValidateRequestInput) => {
    return validateCookies(input.req, input.schema?.cookies);
  },
  params: (input: ValidateRequestInput) => {
    return validateParams(input.req, input.schema?.params);
  },
} as const satisfies Record<
  Exclude<keyof RequestSchema, "body">,
  (input: ValidateRequestInput) => unknown
>;

export class RequestValidator {
  private validateField<T>(validate: () => T) {
    const [error, value] = mightThrowSync(validate);

    if (error) {
      return { success: false as const, error };
    }

    return { success: true as const, value };
  }

  private async validateFieldAsync<T>(validate: () => Promise<T>) {
    const [error, value] = await mightThrow(validate());

    if (error) {
      return { success: false as const, error };
    }

    return { success: true as const, value };
  }

  public async validate(
    input: ValidateRequestInput,
  ): Promise<ValidateRequestResult> {
    if (!input.schema) {
      return { success: true, data: {} };
    }

    const data: ValidatedRequest = {};

    for (const field of schemaFields) {
      if (!input.schema[field]) {
        continue;
      }

      if (field === "body") {
        const result = await this.validateFieldAsync(() => {
          return validateBody(input.req, input.schema?.body, input.bodyCache);
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }

        data.body = result.value;
        continue;
      }

      const result = this.validateField(() => {
        return syncFieldValidators[field](input);
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      data[field] = result.value;
    }

    return { success: true, data };
  }
}
