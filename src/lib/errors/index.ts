import type { CommonError } from "./types.js";

export const ok = <T>(data: T) => {
  return [null, data] as const;
};

export const err = <T extends CommonError>(type: T, message: string) => {
  return [{ type, message }, null] as const;
};

export const mightThrowSync = <T>(fn: () => T) => {
  try {
    const result = fn();
    return [null, result] as const;
  } catch (error) {
    return [error, null] as const;
  }
};

export const mightThrow = async <T>(promise: Promise<T>) => {
  try {
    const data = await promise;
    return [null, data] as const;
  } catch (error) {
    return [error, null] as const;
  }
};
