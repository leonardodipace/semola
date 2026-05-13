import type { CommonError } from "./types.js";

export const ok = <T>(data: T) => {
  return [null, data] as const;
};

export const err = <T extends CommonError>(type: T, message: string) => {
  return [{ type, message }, null] as const;
};

export const mightThrowSync = <T, E = Error>(
  fn: () => T,
): readonly [null, T] | readonly [E, null] => {
  try {
    const result = fn();
    return [null, result] as const;
  } catch (error) {
    return [error as E, null] as const;
  }
};

export const mightThrow = async <T, E = Error>(
  promise: Promise<T>,
): Promise<readonly [null, T] | readonly [E, null]> => {
  try {
    const data = await promise;
    return [null, data] as const;
  } catch (error) {
    return [error as E, null] as const;
  }
};
