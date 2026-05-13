export type BaseColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = {
  sqlName: string;
  _meta: ColumnTypeState<TNullable, TPrimaryKey, TUnique, THasDefault>;
  _default?: () => unknown;
  references?: {
    tableColumn?: () => { sqlName: string };
  };
};

type ColumnTypeState<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = {
  isNullable: TNullable;
  isPrimaryKey: TPrimaryKey;
  isUnique: TUnique;
  hasDefault: THasDefault;
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
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault> & {
  type: "string";
};

export type NumberColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault> & {
  type: "number";
};

export type BooleanColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault> & {
  type: "boolean";
};

export type DateColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault> & {
  type: "date";
};

export type Column = StringColumn | NumberColumn | BooleanColumn | DateColumn;

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
  _meta: ColumnTypeState<TNullable, TPrimaryKey, TUnique, THasDefault>;
  _default?: () => ColumnRuntimeValueMap[TType];
  references?: {
    tableColumn?: () => { sqlName: string };
  };
};

type SetNullable<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
> = ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique, THasDefault>;

type SetHasDefault<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
> = ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique, true>;

type SetPrimaryKey<
  TType extends ColumnType,
  _TNullable extends boolean,
  _TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
> = ColumnBuilder<TType, false, true, TUnique, THasDefault>;

type SetUnique<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  _TUnique extends boolean,
  THasDefault extends boolean,
> = ColumnBuilder<TType, TNullable, TPrimaryKey, true, THasDefault>;

export type ColumnBuilder<
  TType extends ColumnType,
  TNullable extends boolean = true,
  TPrimaryKey extends boolean = false,
  TUnique extends boolean = false,
  THasDefault extends boolean = false,
> = ColumnBuilderState<TType, TNullable, TPrimaryKey, TUnique, THasDefault> & {
  primaryKey: () => SetPrimaryKey<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault
  >;
  notNull: () => SetNullable<TType, false, TPrimaryKey, TUnique, THasDefault>;
  nullable: () => SetNullable<TType, true, TPrimaryKey, TUnique, THasDefault>;
  unique: () => SetUnique<TType, TNullable, TPrimaryKey, TUnique, THasDefault>;
  default: (
    value: () => ColumnRuntimeValueMap[TType],
  ) => SetHasDefault<TType, TNullable, TPrimaryKey, TUnique>;
  references: ((
    tableColumn: () => { sqlName: string },
  ) => ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique, THasDefault>) & {
    tableColumn?: () => { sqlName: string };
  };
};
