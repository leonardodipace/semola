import type { SQL } from "bun";
import { err, mightThrow, ok } from "../../errors/index.js";
import type { ColumnKind } from "../types.js";
import type {
  IntrospectedArrayElementKind,
  IntrospectedColumn,
  IntrospectedTable,
  OnDeleteAction,
} from "./types.js";

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

function mapDbType(
  dataType: string,
  udtName: string,
  enumTypes: Set<string>,
): {
  kind: ColumnKind;
  unknown: string | null;
  arrayElementKind: IntrospectedArrayElementKind | null;
  enumValues: string[] | null;
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
    }

    return {
      kind: scalar.kind,
      unknown,
      arrayElementKind: inferArrayElementKind(udtName),
      enumValues: isEnumArray ? [] : null,
    };
  }

  const normalizedUdt = udtName.toLowerCase();
  const isUserDefined = dataType === "USER-DEFINED";

  if (isUserDefined && enumTypes.has(normalizedUdt)) {
    return {
      kind: "string",
      unknown: null,
      arrayElementKind: null,
      enumValues: [],
    };
  }

  const effectiveType = isUserDefined ? normalizedUdt : dataType;
  const scalar = mapScalarDbType(effectiveType);

  return {
    ...scalar,
    arrayElementKind: null,
    enumValues: null,
  };
}

function toOnDelete(rule: string): OnDeleteAction | null {
  if (rule === "CASCADE") return "CASCADE";
  if (rule === "RESTRICT") return "RESTRICT";
  if (rule === "SET NULL") return "SET NULL";
  return null;
}

function toErrMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function introspectPostgres(sql: SQL, schema = "public") {
  const [enumErr, enumRows] = await mightThrow(
    sql`
      SELECT
        t.typname,
        e.enumlabel
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_enum e
        ON e.enumtypid = t.oid
      JOIN pg_catalog.pg_namespace n
        ON n.oid = t.typnamespace
      WHERE n.nspname = ${schema}
      ORDER BY t.typname, e.enumsortorder
    `.values() as Promise<[string, string][]>,
  );

  if (enumErr) {
    return err("IntrospectError", `Failed to list enums: ${toErrMsg(enumErr)}`);
  }

  const enumMap = new Map<string, string[]>();

  for (const [typeName, enumLabel] of enumRows ?? []) {
    const key = typeName.toLowerCase();
    const labels = enumMap.get(key);

    if (labels) {
      labels.push(enumLabel);
      continue;
    }

    enumMap.set(key, [enumLabel]);
  }

  const enumTypes = new Set(enumMap.keys());

  const [tablesErr, tableRows] = await mightThrow(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schema}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `.values() as Promise<[string][]>,
  );

  if (tablesErr) {
    return err(
      "IntrospectError",
      `Failed to list tables: ${toErrMsg(tablesErr)}`,
    );
  }

  const tableNames = (tableRows ?? []).map((row) => row[0]);
  const tables: IntrospectedTable[] = [];

  for (const tableName of tableNames) {
    const [colErr, colRows] = await mightThrow(
      sql`
        SELECT
          column_name,
          udt_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = ${tableName}
        ORDER BY ordinal_position
      `.values() as Promise<[string, string, string, string, string | null][]>,
    );

    if (colErr) {
      return err(
        "IntrospectError",
        `Failed to list columns for ${tableName}: ${toErrMsg(colErr)}`,
      );
    }

    const [constraintErr, constraintRows] = await mightThrow(
      sql`
        SELECT
          kcu.column_name,
          tc.constraint_type,
          COUNT(*) OVER (PARTITION BY tc.constraint_name) AS constrained_columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = ${schema}
          AND tc.table_name = ${tableName}
          AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
        UNION ALL
        SELECT
          a.attname AS column_name,
          'UNIQUE' AS constraint_type,
          1 AS constrained_columns
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class t
          ON t.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n
          ON n.oid = t.relnamespace
        JOIN LATERAL unnest(i.indkey::smallint[]) AS key(attnum)
          ON TRUE
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = t.oid
          AND a.attnum = key.attnum
        WHERE n.nspname = ${schema}
          AND t.relname = ${tableName}
          AND i.indisunique = TRUE
          AND i.indisprimary = FALSE
          AND i.indexprs IS NULL
          AND i.indpred IS NULL
          AND i.indnkeyatts = 1
      `.values() as Promise<[string, string, number][]>,
    );

    if (constraintErr) {
      return err(
        "IntrospectError",
        `Failed to list constraints for ${tableName}: ${toErrMsg(constraintErr)}`,
      );
    }

    const [fkErr, fkRows] = await mightThrow(
      sql`
        SELECT
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
          AND tc.table_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON rc.unique_constraint_name = ccu.constraint_name
          AND rc.unique_constraint_schema = ccu.constraint_schema
        WHERE tc.table_schema = ${schema}
          AND tc.table_name = ${tableName}
          AND tc.constraint_type = 'FOREIGN KEY'
      `.values() as Promise<[string, string, string, string][]>,
    );

    if (fkErr) {
      return err(
        "IntrospectError",
        `Failed to list foreign keys for ${tableName}: ${toErrMsg(fkErr)}`,
      );
    }

    const safeConstraintRows = (constraintRows ?? []) as Array<
      [string, string, number?]
    >;
    const safeFkRows = fkRows ?? [];
    const safeColRows = colRows ?? [];

    const primaryKeys = new Set(
      safeConstraintRows
        .filter(([, constraintType]) => constraintType === "PRIMARY KEY")
        .map(([columnName]) => columnName),
    );

    const uniqueCols = new Set(
      safeConstraintRows
        .filter(([, constraintType, constrainedColumns]) => {
          if (constraintType !== "UNIQUE") {
            return false;
          }

          if (constrainedColumns === undefined) {
            return true;
          }

          return constrainedColumns === 1;
        })
        .map(([columnName]) => columnName),
    );

    const fkMap = new Map<string, [string, string, string]>();
    for (const [
      columnName,
      foreignTableName,
      foreignColumnName,
      deleteRule,
    ] of safeFkRows) {
      fkMap.set(columnName, [foreignTableName, foreignColumnName, deleteRule]);
    }

    const columns: IntrospectedColumn[] = safeColRows.map(
      ([columnName, udtName, dataType, isNullable, columnDefault]) => {
        const { kind, unknown, arrayElementKind, enumValues } = mapDbType(
          dataType,
          udtName,
          enumTypes,
        );

        let resolvedEnumValues = enumValues;

        if (resolvedEnumValues !== null) {
          const enumTypeName =
            dataType.toLowerCase() === "array"
              ? udtName.toLowerCase().replace(/^_/, "")
              : udtName.toLowerCase();

          resolvedEnumValues = enumMap.get(enumTypeName) ?? [];
        }

        const fk = fkMap.get(columnName);

        return {
          sqlName: columnName,
          kind,
          enumValues: resolvedEnumValues,
          nullable: isNullable === "YES",
          primaryKey: primaryKeys.has(columnName),
          unique: uniqueCols.has(columnName),
          rawDefault: columnDefault,
          arrayElementKind,
          references: fk
            ? {
                table: fk[0],
                column: fk[1],
                onDelete: toOnDelete(fk[2]),
              }
            : null,
          unknownDbType: unknown,
        };
      },
    );

    tables.push({ name: tableName, columns });
  }

  return ok(tables);
}
