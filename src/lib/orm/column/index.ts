import type { Column, ColumnBuilder, ColumnRuntimeValueMap } from "./types.js";

type ColumnBuilderState<
  TType extends Column["type"],
  TNullable extends boolean,
> = Omit<Extract<Column, { type: TType }>, "default" | "_meta"> & {
  _meta: {
    isNullable: TNullable;
  };
};

const createColumnBuilder = <
  TType extends Column["type"],
  TNullable extends boolean,
>(
  column: ColumnBuilderState<TType, TNullable>,
): ColumnBuilder<TType, TNullable> => {
  const primaryKey = () => {
    return createColumnBuilder<TType, TNullable>({
      ...column,
      primaryKey: true,
    });
  };

  const notNull = () => {
    return createColumnBuilder<TType, false>({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: false,
      },
    });
  };

  const nullable = () => {
    return createColumnBuilder<TType, true>({
      ...column,
      _meta: {
        ...column._meta,
        isNullable: true,
      },
    });
  };

  const unique = () => {
    return createColumnBuilder<TType, TNullable>({
      ...column,
      unique: true,
    });
  };

  const defaultHandler = (_value: () => ColumnRuntimeValueMap[TType]) => {
    return createColumnBuilder<TType, TNullable>({
      ...column,
      hasDefault: true,
    });
  };

  return {
    ...column,
    primaryKey,
    notNull,
    nullable,
    unique,
    default: defaultHandler,
  };
};

export const string = (sqlName: string): ColumnBuilder<"string"> => {
  const column: ColumnBuilderState<"string", true> = {
    sqlName,
    type: "string",
    _meta: {
      isNullable: true,
    },
  };

  return createColumnBuilder<"string", true>(column);
};

export const uuid = (sqlName: string): ColumnBuilder<"string"> => {
  return string(sqlName);
};

export const number = (sqlName: string): ColumnBuilder<"number"> => {
  const column: ColumnBuilderState<"number", true> = {
    sqlName,
    type: "number",
    _meta: {
      isNullable: true,
    },
  };

  return createColumnBuilder<"number", true>(column);
};

export const boolean = (sqlName: string): ColumnBuilder<"boolean"> => {
  const column: ColumnBuilderState<"boolean", true> = {
    sqlName,
    type: "boolean",
    _meta: {
      isNullable: true,
    },
  };

  return createColumnBuilder<"boolean", true>(column);
};

export const date = (sqlName: string): ColumnBuilder<"date"> => {
  const column: ColumnBuilderState<"date", true> = {
    sqlName,
    type: "date",
    _meta: {
      isNullable: true,
    },
  };

  return createColumnBuilder<"date", true>(column);
};
