import type { RequestSchema } from "../core/types.js";

export type BodyCache = { parsed: boolean; value: unknown };

export type ValidateRequestInput = {
  req: Bun.BunRequest;
  schema?: RequestSchema;
  bodyCache?: BodyCache;
};

export type ValidateRequestSuccess = {
  success: true;
  data: Record<string, unknown>;
};

export type ValidateRequestFailure = {
  success: false;
  error: Error;
};

export type ValidateRequestResult =
  | ValidateRequestSuccess
  | ValidateRequestFailure;
