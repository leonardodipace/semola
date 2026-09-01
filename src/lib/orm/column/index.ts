import { OrmError } from "../errors.js";
import type {
  ColumnBuilder,
  ColumnRuntimeValueMap,
  ColumnType,
} from "./types.js";

const sqlLiteral = (value: unknown) => {
  if (value === null) {
    return "NULL";
  }

  if (value === undefined) {
    throw new OrmError("dbDefault cannot be undefined");
  }

  if (typeof value === "boolean") {
    if (value) {
      return "TRUE";
    }

    return "FALSE";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OrmError("dbDefault number must be finite");
    }

    return String(value);
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }

  return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
};

const sqlJsonLiteral = (value: unknown) => {
  if (value === null) {
    return "NULL";
  }

  if (value === undefined) {
    throw new OrmError("dbDefault cannot be undefined");
  }

  return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
};

const dbDefaultLiteral = (type: ColumnType, value: unknown) => {
  if (type === "json") {
    return sqlJsonLiteral(value);
  }

  if (type === "jsonb") {
    return sqlJsonLiteral(value);
  }

  return sqlLiteral(value);
};

type ColumnBuilderState<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = {
  sqlName: string;
  type: TType;
  _meta: {
    isNullable: TNullable;
    isPrimaryKey: TPrimaryKey;
    isUnique: TUnique;
    hasDefault: THasDefault;
    default?: () => TValue;
    dbDefault?: string;
  };
  sqlType?: "uuid";
  enumValues?: readonly TValue[];
  references?: {
    tableColumn: () => { sqlName: string };
  };
};

const createColumnBuilder = <
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
>(
  column: ColumnBuilderState<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >,
): ColumnBuilder<
  TType,
  TNullable,
  TPrimaryKey,
  TUnique,
  THasDefault,
  TValue
> => {
  const primaryKey: ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["primaryKey"] = () => {
    return createColumnBuilder<
      TType,
      false,
      true,
      TUnique,
      THasDefault,
      TValue
    >({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: false,
        isPrimaryKey: true,
      },
    });
  };

  const notNull: ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["notNull"] = () => {
    return createColumnBuilder<
      TType,
      false,
      TPrimaryKey,
      TUnique,
      THasDefault,
      TValue
    >({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: false,
      },
    });
  };

  const nullable = (() => {
    if (column._meta.isPrimaryKey) {
      return createColumnBuilder<
        TType,
        false,
        TPrimaryKey,
        TUnique,
        THasDefault,
        TValue
      >({
        ...column,
        _meta: {
          ...column._meta,
          isNullable: false,
        },
      });
    }

    return createColumnBuilder<
      TType,
      true,
      TPrimaryKey,
      TUnique,
      THasDefault,
      TValue
    >({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: true,
      },
    });
  }) as ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["nullable"];

  const unique: ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["unique"] = () => {
    return createColumnBuilder<
      TType,
      TNullable,
      TPrimaryKey,
      true,
      THasDefault,
      TValue
    >({
      ...column,
      _meta: {
        ...column._meta,
        isUnique: true,
      },
    });
  };

  const defaultHandler: ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["default"] = (value) => {
    return createColumnBuilder<
      TType,
      TNullable,
      TPrimaryKey,
      TUnique,
      true,
      TValue
    >({
      ...column,
      _meta: {
        ...column._meta,
        hasDefault: true,
        default: value,
      },
    });
  };

  const dbDefault = ((
    value: TValue | string,
    options?: { as?: "value" | "sql" },
  ) => {
    if (options?.as === "sql") {
      const sql = String(value).trim();

      if (!sql) {
        throw new OrmError(`Column ${column.sqlName} has an empty dbDefault`);
      }

      if (sql.includes(";")) {
        throw new OrmError(
          `Column ${column.sqlName} dbDefault SQL must be a single expression (no ";")`,
        );
      }

      if (sql.includes("--")) {
        throw new OrmError(
          `Column ${column.sqlName} dbDefault SQL cannot contain "--" comments`,
        );
      }

      if (sql.includes("/*")) {
        throw new OrmError(
          `Column ${column.sqlName} dbDefault SQL cannot contain "/*" comments`,
        );
      }

      return createColumnBuilder<
        TType,
        TNullable,
        TPrimaryKey,
        TUnique,
        true,
        TValue
      >({
        ...column,
        _meta: {
          ...column._meta,
          hasDefault: true,
          dbDefault: sql,
        },
      });
    }

    return createColumnBuilder<
      TType,
      TNullable,
      TPrimaryKey,
      TUnique,
      true,
      TValue
    >({
      ...column,
      _meta: {
        ...column._meta,
        hasDefault: true,
        dbDefault: dbDefaultLiteral(column.type, value),
      },
    });
  }) as ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["dbDefault"];

  const referencesBuilder = (tableColumn: () => { sqlName: string }) => {
    return createColumnBuilder<
      TType,
      TNullable,
      TPrimaryKey,
      TUnique,
      THasDefault,
      TValue
    >({
      ...column,
      references: {
        tableColumn,
      },
    });
  };

  const references: ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >["references"] = referencesBuilder;

  references.tableColumn = column.references?.tableColumn;

  return {
    ...column,
    primaryKey,
    notNull,
    nullable,
    unique,
    default: defaultHandler,
    dbDefault,
    references,
  };
};

const createBaseColumn = <
  TType extends ColumnType,
  TValue extends ColumnRuntimeValueMap[TType] = ColumnRuntimeValueMap[TType],
>(
  sqlName: string,
  type: TType,
  enumValues?: readonly TValue[],
) => {
  const column: ColumnBuilderState<TType, true, false, false, false, TValue> = {
    sqlName,
    type,
    enumValues,
    _meta: {
      isNullable: true,
      isPrimaryKey: false,
      isUnique: false,
      hasDefault: false,
    },
  };

  return createColumnBuilder<TType, true, false, false, false, TValue>(column);
};

export const string = (sqlName: string): ColumnBuilder<"string"> => {
  return createBaseColumn(sqlName, "string");
};

export const uuid = (sqlName: string): ColumnBuilder<"string"> => {
  const column = createBaseColumn(sqlName, "string");

  return createColumnBuilder({
    sqlName: column.sqlName,
    type: column.type,
    _meta: column._meta,
    sqlType: "uuid",
  });
};

export const number = (sqlName: string): ColumnBuilder<"number"> => {
  return createBaseColumn(sqlName, "number");
};

export const boolean = (sqlName: string): ColumnBuilder<"boolean"> => {
  return createBaseColumn(sqlName, "boolean");
};

export const date = (sqlName: string): ColumnBuilder<"date"> => {
  return createBaseColumn(sqlName, "date");
};

export const enumType = <const TValues extends readonly string[]>(
  sqlName: string,
  values: TValues,
): ColumnBuilder<"enum", true, false, false, false, TValues[number]> => {
  return createBaseColumn<"enum", TValues[number]>(sqlName, "enum", values);
};

export const json = <T = unknown>(
  sqlName: string,
): ColumnBuilder<"json", true, false, false, false, T> => {
  return createBaseColumn<"json", T>(sqlName, "json");
};

export const jsonb = <T = unknown>(
  sqlName: string,
): ColumnBuilder<"jsonb", true, false, false, false, T> => {
  return createBaseColumn<"jsonb", T>(sqlName, "jsonb");
};
