import type { StandardSchemaV1 } from "@standard-schema/spec";
import { err, mightThrow, ok } from "../errors/index.js";

export const parseBody = async (
  req: Request,
  bodySchema?: StandardSchemaV1,
) => {
  if (!bodySchema) {
    return ok(undefined);
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return ok(undefined);
  }

  const [parseError, parsedBody] = await mightThrow(req.json());

  if (parseError) {
    return err("ParseError", "Invalid JSON body");
  }

  return ok(parsedBody);
};
