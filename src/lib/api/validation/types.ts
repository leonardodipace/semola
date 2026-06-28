import type { RequestSchema } from "../core/types.js";

export type BodyCache = {
  parsed: boolean;
  value: unknown;
};

export type RequestValidator = (
  req: Bun.BunRequest,
  bodyCache?: BodyCache,
) => Promise<Error | undefined>;

export type ValidateRequestInput = {
  req: Bun.BunRequest;
  schema?: RequestSchema;
  bodyCache?: BodyCache;
};
