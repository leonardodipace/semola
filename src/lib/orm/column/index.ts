import type { Column, ColumnBuilder, ColumnRuntimeValueMap } from "./types.js";

type ColumnBuilderState<
  TType extends Column["type"],
  TNullable extends boolean,
> = Omit<Extract<Column, { type: TType }>, "default" | "isNullable"> & {
  isNullable: TNullable;
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
    return createColumnBuilder<TType, false>({ ...column, isNullable: false });
  };

  const nullable = () => {
    return createColumnBuilder<TType, true>({ ...column, isNullable: true });
  };

  const unique = () => {
    return createColumnBuilder<TType, TNullable>({ ...column, unique: true });
  };

  const defaultHandler = (_value: () => ColumnRuntimeValueMap[TType]) => {
    return createColumnBuilder<TType, TNullable>({ ...column });
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
  const column = {
    sqlName,
    type: "string",
    isNullable: true,
  } as const;

  return createColumnBuilder<"string", true>(column);
};

export const uuid = (sqlName: string): ColumnBuilder<"string"> => {
  return string(sqlName);
};

export const number = (sqlName: string): ColumnBuilder<"number"> => {
  const column = {
    sqlName,
    type: "number",
    isNullable: true,
  } as const;

  return createColumnBuilder<"number", true>(column);
};

export const boolean = (sqlName: string): ColumnBuilder<"boolean"> => {
  const column = {
    sqlName,
    type: "boolean",
    isNullable: true,
  } as const;

  return createColumnBuilder<"boolean", true>(column);
};

export const date = (sqlName: string): ColumnBuilder<"date"> => {
  const column = {
    sqlName,
    type: "date",
    isNullable: true,
  } as const;

  return createColumnBuilder<"date", true>(column);
};
