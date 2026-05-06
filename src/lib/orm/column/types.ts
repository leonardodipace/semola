export type BaseColumn = {
  sqlName: string;
  _meta: ColumnTypeState;
  primaryKey?: boolean;
  unique?: boolean;
  hasDefault?: boolean;
  references?: {
    tableColumn: () => { sqlName: string };
  };
};

type ColumnTypeState<TNullable extends boolean = boolean> = {
  isNullable: TNullable;
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
> = Omit<ColumnByType<TType>, "default" | "_meta"> & {
  _meta: ColumnTypeState<TNullable>;
};

type SetNullable<
  TType extends Column["type"],
  TNullable extends boolean,
> = ColumnBuilder<TType, TNullable>;

type SetHasDefault<
  TType extends Column["type"],
  TNullable extends boolean,
> = ColumnBuilder<TType, TNullable>;

type SetPrimaryKey<
  TType extends Column["type"],
  TNullable extends boolean,
> = ColumnBuilder<TType, TNullable>;

type SetUnique<
  TType extends Column["type"],
  TNullable extends boolean,
> = ColumnBuilder<TType, TNullable>;

export type ColumnBuilder<
  TType extends Column["type"],
  TNullable extends boolean = true,
> = ColumnBuilderState<TType, TNullable> & {
  primaryKey: () => SetPrimaryKey<TType, TNullable>;
  notNull: () => SetNullable<TType, false>;
  nullable: () => SetNullable<TType, true>;
  unique: () => SetUnique<TType, TNullable>;
  default: (
    value: () => ColumnRuntimeValueMap[TType],
  ) => SetHasDefault<TType, TNullable>;
  references: (
    tableColumn: () => { sqlName: string },
  ) => ColumnBuilder<TType, TNullable>;
};
