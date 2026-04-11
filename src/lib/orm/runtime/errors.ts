import { mightThrow } from "../../errors/index.js";

export { inferDialectFromUrl } from "../dialect/utils.js";

function toOrmErrorMessage(errorValue: unknown) {
  if (errorValue instanceof Error) {
    return errorValue.message;
  }

  if (typeof errorValue === "object" && errorValue !== null) {
    const message = Reflect.get(errorValue, "message");

    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown ORM error";
}

export async function executeOrThrow<T>(promise: Promise<T>) {
  const [error, data] = await mightThrow(promise);

  if (error !== null) {
    throw new Error(toOrmErrorMessage(error));
  }

  if (data === null) {
    throw new Error("ORM operation returned no data");
  }

  return data;
}
