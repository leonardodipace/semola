import type { Table } from "../table/types.js";
import type { HasMany, HasOne } from "./types.js";

export class HasManyRelation<T extends Table> {
  public readonly _type = "hasMany" as const;
  public readonly _table: T;

  public constructor(table: T) {
    this._table = table;
  }
}

export class HasOneRelation<T extends Table, TKey extends string = string> {
  public readonly _type = "hasOne" as const;
  public readonly _table: T;
  public readonly _foreignKey: TKey;

  public constructor(foreignKey: TKey, table: T) {
    this._foreignKey = foreignKey;
    this._table = table;
  }
}

export const many = <T extends Table>(table: () => T): HasMany<T> => {
  return new HasManyRelation(table());
};

export const one = <T extends Table, const TKey extends string>(
  foreignKey: TKey,
  table: () => T,
): HasOne<T, TKey> => {
  return new HasOneRelation(foreignKey, table());
};
