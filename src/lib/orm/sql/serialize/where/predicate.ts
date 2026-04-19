import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../../../table.js";
import type {
  ColDefs,
  DialectAdapter,
  WherePredicate,
} from "../../../types.js";

function toColumnValue(
  table: Table<ColDefs>,
  key: string,
  value: unknown,
  dialectAdapter: DialectAdapter,
) {
  const col = table.columns[key];

  if (!col) {
    return {
      exists: false,
      kind: null,
      serialized: value,
      sqlName: key,
    };
  }

  return {
    exists: true,
    kind: col.kind,
    serialized: dialectAdapter.serializeValue(col.kind, value),
    sqlName: col.meta.sqlName,
  };
}

export function serializeWherePredicate<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  predicate: WherePredicate<T>,
  dialectAdapter: DialectAdapter,
) {
  const { exists, kind, serialized, sqlName } = toColumnValue(
    table,
    predicate.key,
    predicate.value,
    dialectAdapter,
  );

  if (!exists) {
    return null;
  }

  const column = sql(sqlName);

  switch (predicate.op) {
    case "eq":
      return sql`${column} = ${serialized}`;

    case "neq":
      return sql`${column} != ${serialized}`;

    case "gt":
      return sql`${column} > ${serialized}`;

    case "gte":
      return sql`${column} >= ${serialized}`;

    case "lt":
      return sql`${column} < ${serialized}`;

    case "lte":
      return sql`${column} <= ${serialized}`;

    case "like": {
      const likeValue = predicate.value;

      if (typeof likeValue !== "object" || likeValue === null) {
        return null;
      }

      const mode = Reflect.get(likeValue, "mode");
      const val = Reflect.get(likeValue, "value");

      if (mode !== "startsWith" && mode !== "endsWith" && mode !== "contains") {
        return null;
      }

      if (typeof val !== "string") {
        return null;
      }

      const pattern = dialectAdapter.renderLikePattern(mode, val);

      if (dialectAdapter.likeKeyword === "ILIKE") {
        return sql`${column} ILIKE ${pattern}`;
      }

      return sql`${column} LIKE ${pattern}`;
    }

    case "in": {
      if (!Array.isArray(predicate.value)) {
        return null;
      }

      if (predicate.value.length === 0) {
        return null;
      }

      const values: unknown[] = new Array(predicate.value.length);

      for (let index = 0; index < predicate.value.length; index++) {
        const item = predicate.value[index];

        if (!kind) {
          values[index] = item;
          continue;
        }

        values[index] = dialectAdapter.serializeValue(kind, item);
      }

      return sql`${column} IN ${sql(values)}`;
    }

    case "not_in": {
      if (!Array.isArray(predicate.value)) {
        return null;
      }

      if (predicate.value.length === 0) {
        return null;
      }

      const values: unknown[] = new Array(predicate.value.length);

      for (let index = 0; index < predicate.value.length; index++) {
        const item = predicate.value[index];

        if (!kind) {
          values[index] = item;
          continue;
        }

        values[index] = dialectAdapter.serializeValue(kind, item);
      }

      return sql`${column} NOT IN ${sql(values)}`;
    }

    case "is_null":
      return sql`${column} IS NULL`;

    case "is_not_null":
      return sql`${column} IS NOT NULL`;

    default:
      return null;
  }
}
