import type { ColumnKind } from "../../../types.js";
import type { IntrospectedArrayElementKind } from "../../types.js";

function mapScalarDbType(dbType: string): {
  kind: ColumnKind;
  unknown: string | null;
} {
  const t = dbType
    .toLowerCase()
    .replace(/\(.*\)/, "")
    .trim();

  if (t === "uuid") {
    return { kind: "uuid", unknown: null };
  }

  if (
    t === "text" ||
    t === "varchar" ||
    t === "character varying" ||
    t === "char" ||
    t === "character" ||
    t === "citext" ||
    t === "name"
  ) {
    return { kind: "string", unknown: null };
  }

  if (
    t === "int" ||
    t === "integer" ||
    t === "int4" ||
    t === "bigint" ||
    t === "int8" ||
    t === "smallint" ||
    t === "int2" ||
    t === "serial" ||
    t === "bigserial" ||
    t === "smallserial" ||
    t === "numeric" ||
    t === "decimal" ||
    t === "real" ||
    t === "double precision" ||
    t === "float4" ||
    t === "float8"
  ) {
    return { kind: "number", unknown: null };
  }

  if (t === "boolean" || t === "bool") {
    return { kind: "boolean", unknown: null };
  }

  if (
    t === "timestamp" ||
    t === "timestamp without time zone" ||
    t === "timestamp with time zone" ||
    t === "timestamptz" ||
    t === "date" ||
    t === "time" ||
    t === "time without time zone" ||
    t === "time with time zone"
  ) {
    return { kind: "date", unknown: null };
  }

  if (t === "json") {
    return { kind: "json", unknown: null };
  }

  if (t === "jsonb") {
    return { kind: "jsonb", unknown: null };
  }

  return { kind: "string", unknown: dbType };
}

function inferArrayElementKind(
  udtName: string,
): IntrospectedArrayElementKind | null {
  const normalized = udtName.toLowerCase();

  if (!normalized.startsWith("_")) {
    return "string";
  }

  const elementDbType = normalized.slice(1);
  const scalar = mapScalarDbType(elementDbType);

  if (scalar.kind === "uuid") {
    return "uuid";
  }

  if (scalar.kind === "number") {
    return "number";
  }

  if (scalar.kind === "boolean") {
    return "boolean";
  }

  return "string";
}

export function mapDbType(
  dataType: string,
  udtName: string,
  enumTypes: Set<string>,
): {
  kind: ColumnKind;
  unknown: string | null;
  arrayElementKind: IntrospectedArrayElementKind | null;
} {
  if (dataType.toLowerCase() === "array") {
    const normalized = udtName.toLowerCase();
    const elementDbType = normalized.startsWith("_")
      ? normalized.slice(1)
      : normalized;

    const scalar = mapScalarDbType(elementDbType);
    const isEnumArray = enumTypes.has(elementDbType);

    let unknown: string | null = scalar.unknown;

    if (isEnumArray) {
      unknown = null;
      scalar.kind = "enum";
    }

    return {
      kind: scalar.kind,
      unknown,
      arrayElementKind: inferArrayElementKind(udtName),
    };
  }

  const isUserDefined = dataType === "USER-DEFINED";
  if (isUserDefined && enumTypes.has(udtName)) {
    return {
      kind: "enum",
      unknown: null,
      arrayElementKind: null,
    };
  }

  const effectiveType = isUserDefined ? udtName.toLowerCase() : dataType;
  const scalar = mapScalarDbType(effectiveType);

  return {
    ...scalar,
    arrayElementKind: null,
  };
}
