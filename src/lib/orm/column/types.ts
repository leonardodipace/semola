export type BaseColumn = {
  sqlName: string;
  isNullable: boolean;
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

type ColumnBuilderState<
  TType extends Column["type"],
  TNullable extends boolean,
> = Omit<ColumnByType<TType>, "default" | "isNullable"> & {
  isNullable: TNullable;
};

export type ColumnBuilder<
  TType extends Column["type"],
  TNullable extends boolean = true,
> = ColumnBuilderState<TType, TNullable> & {
  primaryKey: () => ColumnBuilder<TType, TNullable>;
  notNull: () => ColumnBuilder<TType, false>;
  nullable: () => ColumnBuilder<TType, true>;
  unique: () => ColumnBuilder<TType, TNullable>;
  default: (
    value: () => ColumnRuntimeValueMap[TType],
  ) => ColumnBuilder<TType, TNullable>;
};
