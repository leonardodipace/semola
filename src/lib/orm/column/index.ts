import type { Column, ColumnBuilder, ColumnRuntimeValueMap } from "./types.js";

type ColumnType = Column["type"];

type ColumnBuilderState<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
> = {
  sqlName: string;
  type: TType;
  _meta: {
    isNullable: TNullable;
    isPrimaryKey: TPrimaryKey;
    isUnique: TUnique;
    hasDefault: THasDefault;
  };
  _default?: () => ColumnRuntimeValueMap[TType];
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
>(
  column: ColumnBuilderState<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault
  >,
): ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique, THasDefault> => {
  const primaryKey = () => {
    return createColumnBuilder<TType, false, true, TUnique, THasDefault>({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: false,
        isPrimaryKey: true,
      },
    });
  };

  const notNull = () => {
    return createColumnBuilder<TType, false, TPrimaryKey, TUnique, THasDefault>(
      {
        ...column,
        _meta: {
          ...column._meta,
          isNullable: false,
        },
      },
    );
  };

  const nullable = () => {
    return createColumnBuilder<TType, true, TPrimaryKey, TUnique, THasDefault>({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: true,
      },
    });
  };

  const unique = () => {
    return createColumnBuilder<
      TType,
      TNullable,
      TPrimaryKey,
      true,
      THasDefault
    >({
      ...column,
      _meta: {
        ...column._meta,
        isUnique: true,
      },
    });
  };

  const defaultHandler = (value: () => ColumnRuntimeValueMap[TType]) => {
    return createColumnBuilder<TType, TNullable, TPrimaryKey, TUnique, true>({
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
      THasDefault
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
    THasDefault
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

const createBaseColumn = <TType extends ColumnType>(
  sqlName: string,
  type: TType,
) => {
  const column: ColumnBuilderState<TType, true, false, false, false> = {
    sqlName,
    type,
    _meta: {
      isNullable: true,
      isPrimaryKey: false,
      isUnique: false,
      hasDefault: false,
    },
  };

  return createColumnBuilder<TType, true, false, false, false>(column);
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
