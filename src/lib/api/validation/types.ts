import type { RequestSchema } from "../core/types.js";

export type BodyCache = { parsed: boolean; value: unknown };

export type ValidateRequestInput = {
  req: Bun.BunRequest;
  schema?: RequestSchema;
  bodyCache?: BodyCache;
};
