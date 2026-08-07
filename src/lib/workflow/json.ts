import { mightThrowSync } from "../errors/index.js";
import { SerializationError } from "./errors.js";

export const toJson = (value: unknown, label: string) => {
  const [error, raw] = mightThrowSync(() => JSON.stringify(value));

  if (error) {
    throw new SerializationError(`Unable to serialize ${label}`);
  }

  if (raw === undefined) return "null";

  if (typeof raw !== "string") {
    throw new SerializationError(`Unable to serialize ${label}`);
  }

  return raw;
};

export const fromJson = <T>(raw: string, label: string) => {
  const [error, value] = mightThrowSync(() => JSON.parse(raw) as T);

  if (error) {
    throw new SerializationError(`Unable to deserialize ${label}`);
  }

  return value;
};
