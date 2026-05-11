export type BaseColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
> = {
  sqlName: string;
  _meta: ColumnTypeState<TNullable, TPrimaryKey, TUnique>;
  hasDefault?: boolean;
  references?: {
    tableColumn?: () => { sqlName: string };
  };
};

type ColumnTypeState<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
> = {
  isNullable: TNullable;
  isPrimaryKey: TPrimaryKey;
  isUnique: TUnique;
};

export type ColumnRuntimeValueMap = {
  string: string;
  number: number;
  boolean: boolean;
  date: Date;
};

export type StringColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique> & {
  type: "string";
};

export type NumberColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique> & {
  type: "number";
};

export type BooleanColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique> & {
  type: "boolean";
};

export type DateColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique> & {
  type: "date";
};

export type Column = StringColumn | NumberColumn | BooleanColumn | DateColumn;

type ColumnType = Column["type"];

type ColumnBuilderState<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
> = {
  sqlName: string;
  type: TType;
  _meta: ColumnTypeState<TNullable, TPrimaryKey, TUnique>;
  hasDefault?: boolean;
  references?: {
    tableColumn?: () => { sqlName: string };
  };
};

type SetNullable<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
> = ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique>;

type SetHasDefault<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
> = ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique>;

type SetPrimaryKey<
  TType extends ColumnType,
  _TNullable extends boolean,
  _TPrimaryKey extends boolean,
  TUnique extends boolean,
> = ColumnBuilder<TType, false, true, TUnique>;

type SetUnique<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  _TUnique extends boolean,
> = ColumnBuilder<TType, TNullable, TPrimaryKey, true>;

export type ColumnBuilder<
  TType extends ColumnType,
  TNullable extends boolean = true,
  TPrimaryKey extends boolean = false,
  TUnique extends boolean = false,
> = ColumnBuilderState<TType, TNullable, TPrimaryKey, TUnique> & {
  primaryKey: () => SetPrimaryKey<TType, TNullable, TPrimaryKey, TUnique>;
  notNull: () => SetNullable<TType, false, TPrimaryKey, TUnique>;
  nullable: () => SetNullable<TType, true, TPrimaryKey, TUnique>;
  unique: () => SetUnique<TType, TNullable, TPrimaryKey, TUnique>;
  default: (
    value: () => ColumnRuntimeValueMap[TType],
  ) => SetHasDefault<TType, TNullable, TPrimaryKey, TUnique>;
  references: ((
    tableColumn: () => { sqlName: string },
  ) => ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique>) & {
    tableColumn?: () => { sqlName: string };
  };
};
