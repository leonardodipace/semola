import type {
  BooleanColumn,
  Column,
  ColumnBuilder,
  ColumnRuntimeValueMap,
  DateColumn,
  NumberColumn,
  StringColumn,
} from "./types.js";

type ColumnBuilderState<TType extends Column["type"]> = Omit<
  Extract<Column, { type: TType }>,
  "default"
>;

const createColumnBuilder = <TType extends Column["type"]>(
  column: ColumnBuilderState<TType>,
): ColumnBuilder<TType> => {
  const primaryKey = () => {
    return createColumnBuilder<TType>({ ...column, primaryKey: true });
  };

  const notNull = () => {
    return createColumnBuilder<TType>({ ...column, nullable: false });
  };

  const nullable = () => {
    return createColumnBuilder<TType>({ ...column, nullable: true });
  };

  const unique = () => {
    return createColumnBuilder<TType>({ ...column, unique: true });
  };

  const defaultHandler = (_value: () => ColumnRuntimeValueMap[TType]) => {
    return createColumnBuilder<TType>({ ...column });
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
  const column: StringColumn = {
    sqlName,
    type: "string",
  };

  return createColumnBuilder<"string">(column);
};

export const uuid = (sqlName: string): ColumnBuilder<"string"> => {
  return string(sqlName);
};

export const number = (sqlName: string): ColumnBuilder<"number"> => {
  const column: NumberColumn = {
    sqlName,
    type: "number",
  };

  return createColumnBuilder<"number">(column);
};

export const boolean = (sqlName: string): ColumnBuilder<"boolean"> => {
  const column: BooleanColumn = {
    sqlName,
    type: "boolean",
  };

  return createColumnBuilder<"boolean">(column);
};

export const date = (sqlName: string): ColumnBuilder<"date"> => {
  const column: DateColumn = {
    sqlName,
    type: "date",
  };

  return createColumnBuilder<"date">(column);
};
