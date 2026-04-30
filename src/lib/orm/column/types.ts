export type BaseColumn = {
  sqlName: string;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
};

export type ColumnRuntimeValueMap = {
  string: string;
  number: number;
  boolean: boolean;
  date: Date;
};

export type StringColumn = BaseColumn & {
  type: "string";
};

export type NumberColumn = BaseColumn & {
  type: "number";
};

export type BooleanColumn = BaseColumn & {
  type: "boolean";
};

export type DateColumn = BaseColumn & {
  type: "date";
};

export type Column = StringColumn | NumberColumn | BooleanColumn | DateColumn;

type ColumnByType<TType extends Column["type"]> = Extract<
  Column,
  { type: TType }
>;

type ColumnBuilderState<TType extends Column["type"]> = Omit<
  ColumnByType<TType>,
  "default"
>;

export type ColumnBuilder<TType extends Column["type"]> =
  ColumnBuilderState<TType> & {
    primaryKey: () => ColumnBuilder<TType>;
    notNull: () => ColumnBuilder<TType>;
    nullable: () => ColumnBuilder<TType>;
    unique: () => ColumnBuilder<TType>;
    default: (
      value: () => ColumnRuntimeValueMap[TType],
    ) => ColumnBuilder<TType>;
  };
