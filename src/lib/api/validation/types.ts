import type { RequestSchema, ValidatedRequest } from "../core/types.js";

export type BodyCache = { parsed: boolean; value: unknown };

export type ValidateRequestInput = {
  req: Bun.BunRequest;
  schema?: RequestSchema;
  bodyCache?: BodyCache;
};

export type ValidateRequestSuccess = {
  success: true;
  data: ValidatedRequest;
};

export type ValidateRequestFailure = {
  success: false;
  error: Error;
};

export type ValidateRequestResult =
  | ValidateRequestSuccess
  | ValidateRequestFailure;
