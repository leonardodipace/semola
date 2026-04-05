import type { IntrospectedColumn } from "../../types.js";
import { parseArrayDefaultValues } from "./parsing/array.js";
import { parseStringLiteral, stripWrappingParens } from "./parsing/literals.js";

export function mapRawDefaultToChain(col: IntrospectedColumn) {
  const rawDefault = col.rawDefault;

  if (!rawDefault) {
    return null;
  }

  const raw = rawDefault.trim();
  const lower = raw.toLowerCase();
  const unwrapped = stripWrappingParens(raw);
  const unwrappedLower = unwrapped.toLowerCase();

  if (col.arrayElementKind) {
    const values = parseArrayDefaultValues(raw, col.arrayElementKind);

    if (values) {
      return `default(${JSON.stringify(values)})`;
    }

    return null;
  }

  if (col.kind === "uuid") {
    if (
      unwrappedLower.includes("gen_random_uuid()") ||
      unwrappedLower.includes("uuid_generate_v4()") ||
      unwrappedLower === "uuid()"
    ) {
      return "defaultFn(() => crypto.randomUUID())";
    }
  }

  if (col.kind === "date") {
    if (
      unwrappedLower === "now()" ||
      unwrappedLower === "current_timestamp" ||
      unwrappedLower === "current_timestamp()" ||
      unwrappedLower === "datetime('now')"
    ) {
      return "defaultFn(() => new Date())";
    }
  }

  const parsedString = parseStringLiteral(raw);

  if (parsedString !== null) {
    return `default(${JSON.stringify(parsedString)})`;
  }

  if (col.kind === "boolean") {
    if (
      lower === "true" ||
      lower === "false" ||
      unwrappedLower === "true" ||
      unwrappedLower === "false"
    ) {
      return `default(${unwrappedLower})`;
    }

    if (unwrapped === "1") {
      return "default(true)";
    }

    if (unwrapped === "0") {
      return "default(false)";
    }
  }

  if (col.kind === "number") {
    if (/^-?\d+(\.\d+)?$/.test(unwrapped)) {
      return `default(${unwrapped})`;
    }
  }

  return null;
}
