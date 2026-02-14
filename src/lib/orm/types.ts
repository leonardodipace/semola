import type { Column, ManyRelation, OneRelation, Table } from "./index.js";

// --- Column extractors ---

type IsColumn<T> =
  T extends Column<string, unknown, boolean, boolean, boolean> ? true : false;

type ColumnType<T> =
  T extends Column<string, infer TType, boolean, boolean, boolean>
    ? TType
    : never;

type IsNullable<T> =
  T extends Column<string, unknown, infer N, boolean, boolean> ? N : never;

type IsPrimaryKey<T> =
  T extends Column<string, unknown, boolean, infer TPk, boolean> ? TPk : never;

type IsDefault<T> =
  T extends Column<string, unknown, boolean, boolean, infer TDf> ? TDf : false;

// --- Relation extractors ---

type IsOneRelation<T> =
  T extends OneRelation<string, unknown, boolean> ? true : false;

type IsManyRelation<T> = T extends ManyRelation<unknown> ? true : false;

type RelationTable<T> =
  T extends OneRelation<string, infer TTable, boolean>
    ? TTable
    : T extends ManyRelation<infer TTable>
      ? TTable
      : never;

type RelationNullable<T> =
  T extends OneRelation<string, unknown, infer N> ? N : false;

// --- Select: what queries return (columns only, no relations) ---

type RequiredSelectKeys<TColumns> = {
  [K in keyof TColumns]: IsColumn<TColumns[K]> extends true
    ? IsNullable<TColumns[K]> extends false
      ? K
      : never
    : never;
}[keyof TColumns];

type OptionalSelectKeys<TColumns> = {
  [K in keyof TColumns]: IsColumn<TColumns[K]> extends true
    ? IsNullable<TColumns[K]> extends true
      ? K
      : never
    : never;
}[keyof TColumns];

export type Select<TColumns> = {
  [K in RequiredSelectKeys<TColumns>]: ColumnType<TColumns[K]>;
} & {
  [K in OptionalSelectKeys<TColumns>]?: ColumnType<TColumns[K]> | null;
};

// --- Insert: columns only, PKs optional, notNull required, relations excluded ---

type RequiredInsertKeys<TColumns> = {
  [K in keyof TColumns]: IsColumn<TColumns[K]> extends true
    ? IsPrimaryKey<TColumns[K]> extends true
      ? never
      : IsNullable<TColumns[K]> extends false
        ? IsDefault<TColumns[K]> extends true
          ? never
          : K
        : never
    : never;
}[keyof TColumns];

type OptionalInsertKeys<TColumns> = {
  [K in keyof TColumns]: IsColumn<TColumns[K]> extends true
    ? IsPrimaryKey<TColumns[K]> extends true
      ? K
      : IsNullable<TColumns[K]> extends true
        ? K
        : IsDefault<TColumns[K]> extends true
          ? K
          : never
    : never;
}[keyof TColumns];

export type Insert<TColumns> = {
  [K in RequiredInsertKeys<TColumns>]: ColumnType<TColumns[K]>;
} & {
  [K in OptionalInsertKeys<TColumns>]?: ColumnType<TColumns[K]> | null;
};

// --- Update: all column fields optional ---

type ColumnKeys<TColumns> = {
  [K in keyof TColumns]: IsColumn<TColumns[K]> extends true ? K : never;
}[keyof TColumns];

export type Update<TColumns> = {
  [K in ColumnKeys<TColumns>]?: ColumnType<TColumns[K]> | null;
};

// --- Where: filter conditions ---

type RelationKeys<TColumns> = {
  [K in keyof TColumns]: IsOneRelation<TColumns[K]> extends true
    ? K
    : IsManyRelation<TColumns[K]> extends true
      ? K
      : never;
}[keyof TColumns];

type TableColumns<T> = T extends Table<string, infer TCols> ? TCols : never;

export type Where<TColumns> = {
  [K in ColumnKeys<TColumns>]?: ColumnType<TColumns[K]> | null;
} & {
  [K in RelationKeys<TColumns>]?: TColumns[K] extends OneRelation<
    string,
    infer TTable,
    boolean
  >
    ? Where<TableColumns<TTable>>
    : TColumns[K] extends ManyRelation<infer TTable>
      ? {
          some?: Where<TableColumns<TTable>>;
          none?: Where<TableColumns<TTable>>;
        }
      : never;
};

// --- Include: which relations to load ---

export type Include<TColumns> = {
  [K in RelationKeys<TColumns>]?: true;
};

// --- SelectWithInclude: base select + included relation data ---

type IncludedFields<TColumns, TInclude> = {
  [K in keyof TInclude & keyof TColumns]: TInclude[K] extends true
    ? IsOneRelation<TColumns[K]> extends true
      ? RelationNullable<TColumns[K]> extends true
        ? Select<TableColumns<RelationTable<TColumns[K]>>> | null
        : Select<TableColumns<RelationTable<TColumns[K]>>>
      : IsManyRelation<TColumns[K]> extends true
        ? Select<TableColumns<RelationTable<TColumns[K]>>>[]
        : never
    : never;
};

export type SelectWithInclude<TColumns, TInclude> = Select<TColumns> &
  IncludedFields<TColumns, TInclude>;
