export type BaseColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
  TValue = unknown,
> = {
  sqlName: string;
  _meta: ColumnTypeState<TNullable, TPrimaryKey, TUnique, THasDefault>;
  _default?: () => TValue;
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
  enum: string;
  json: unknown;
  jsonb: unknown;
};

export type StringColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, string> & {
  type: "string";
};

export type NumberColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, number> & {
  type: "number";
};

export type BooleanColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, boolean> & {
  type: "boolean";
};

export type DateColumn<
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, Date> & {
  type: "date";
};

export type EnumColumn<
  TValue extends string = string,
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, TValue> & {
  type: "enum";
  enumValues?: readonly TValue[];
};

export type JsonColumn<
  TValue = unknown,
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, TValue> & {
  type: "json";
};

export type JsonbColumn<
  TValue = unknown,
  TNullable extends boolean = boolean,
  TPrimaryKey extends boolean = boolean,
  TUnique extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = BaseColumn<TNullable, TPrimaryKey, TUnique, THasDefault, TValue> & {
  type: "jsonb";
};

export type Column =
  | StringColumn
  | NumberColumn
  | BooleanColumn
  | DateColumn
  | EnumColumn
  | JsonColumn
  | JsonbColumn;

type ColumnType = Column["type"];

type ColumnBuilderState<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = {
  sqlName: string;
  type: TType;
  _meta: ColumnTypeState<TNullable, TPrimaryKey, TUnique, THasDefault>;
  _default?: () => TValue;
  enumValues?: readonly TValue[];
  references?: {
    tableColumn?: () => { sqlName: string };
  };
};

type SetNullable<
  TType extends ColumnType,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = ColumnBuilder<
  TType,
  TPrimaryKey extends true ? false : true,
  TPrimaryKey,
  TUnique,
  THasDefault,
  TValue
>;

type SetNotNull<
  TType extends ColumnType,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = ColumnBuilder<TType, false, TPrimaryKey, TUnique, THasDefault, TValue>;

type SetHasDefault<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  TUnique extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = ColumnBuilder<TType, TNullable, TPrimaryKey, TUnique, true, TValue>;

type SetPrimaryKey<
  TType extends ColumnType,
  TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = ColumnBuilder<TType, false, true, TUnique, THasDefault, TValue>;

type SetUnique<
  TType extends ColumnType,
  TNullable extends boolean,
  TPrimaryKey extends boolean,
  _TUnique extends boolean,
  THasDefault extends boolean,
  TValue extends ColumnRuntimeValueMap[TType],
> = ColumnBuilder<TType, TNullable, TPrimaryKey, true, THasDefault, TValue>;

export type ColumnBuilder<
  TType extends ColumnType,
  TNullable extends boolean = true,
  TPrimaryKey extends boolean = false,
  TUnique extends boolean = false,
  THasDefault extends boolean = false,
  TValue extends ColumnRuntimeValueMap[TType] = ColumnRuntimeValueMap[TType],
> = ColumnBuilderState<
  TType,
  TNullable,
  TPrimaryKey,
  TUnique,
  THasDefault,
  TValue
> & {
  primaryKey: () => SetPrimaryKey<TType, TUnique, THasDefault, TValue>;
  notNull: () => SetNotNull<TType, TPrimaryKey, TUnique, THasDefault, TValue>;
  nullable: () => SetNullable<TType, TPrimaryKey, TUnique, THasDefault, TValue>;
  unique: () => SetUnique<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >;
  default: (
    value: () => TValue,
  ) => SetHasDefault<TType, TNullable, TPrimaryKey, TUnique, TValue>;
  references: ((
    tableColumn: () => { sqlName: string },
  ) => ColumnBuilder<
    TType,
    TNullable,
    TPrimaryKey,
    TUnique,
    THasDefault,
    TValue
  >) & {
    tableColumn?: () => { sqlName: string };
  };
};
