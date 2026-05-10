import type { Column, ColumnBuilder, ColumnRuntimeValueMap } from "./types.js";

type ColumnType = Column["type"];

type ColumnBuilderState<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
> = {
  sqlName: string;
  type: TType;
  _meta: {
    isNullable: TNullable;
    isPrimaryKey: TPrimaryKey;
    isUnique: TUnique;
  };
  hasDefault?: boolean;
  references?: {
    tableColumn: () => { sqlName: string };
  };
};

const createColumnBuilder = <
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
>(
  column: ColumnBuilderState<TType, TNullable, TPrimaryKey, TUnique>,
): ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique> => {
  const primaryKey = () => {
    return createColumnBuilder<TType, TNullable, true, TUnique>({
      ...column,
      _meta: {
        ...column._meta,
        isPrimaryKey: true,
      },
    });
  };

  const notNull = () => {
    return createColumnBuilder<TType, false, TPrimaryKey, TUnique>({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: false,
      },
    });
  };

  const nullable = () => {
    return createColumnBuilder<TType, true, TPrimaryKey, TUnique>({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: true,
      },
    });
  };

  const unique = () => {
    return createColumnBuilder<TType, TNullable, TPrimaryKey, true>({
      ...column,
      _meta: {
        ...column._meta,
        isUnique: true,
      },
    });
  };

  const defaultHandler = (_value: () => ColumnRuntimeValueMap[TType]) => {
    return createColumnBuilder<TType, TNullable, TPrimaryKey, TUnique>({
      ...column,
      hasDefault: true,
    });
  };

  const referencesBuilder = (tableColumn: () => { sqlName: string }) => {
    return createColumnBuilder<TType, TNullable, TPrimaryKey, TUnique>({
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
    TUnique
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
  const column: ColumnBuilderState<TType, true, false, false> = {
    sqlName,
    type,
    _meta: {
      isNullable: true,
      isPrimaryKey: false,
      isUnique: false,
    },
  };

  return createColumnBuilder<TType, true, false, false>(column);
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
