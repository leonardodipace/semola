import type { Column, ColumnBuilder, ColumnRuntimeValueMap } from "./types.js";

type ColumnType = Column["type"];

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
  };
  _default?: () => TValue;
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
      },
      _default: value,
    });
  };

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
  return string(sqlName);
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
