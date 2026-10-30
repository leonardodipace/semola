import { NonRetryableStepError } from "./errors.js";
import type { PersistedFailure } from "./types.js";

export const toPersistedFailure = (error: Error): PersistedFailure => ({
  message: error.message,
  name: error.constructor.name || error.name || "Error",
});

// Temporal-style: durable identity is the type name string. Platform
// NonRetryableStepError revives as itself; everything else is Error + .name.
export const reviveFailure = (failure: PersistedFailure) => {
  const { message, name } = failure;

  if (name === "NonRetryableStepError") {
    return new NonRetryableStepError(message);
  }

  const error = new Error(message);
  error.name = name;
  return error;
};
