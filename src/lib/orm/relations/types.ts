import type { Table } from "../table/index.js";
import type { InferTableType } from "../table/types.js";

export type ManyRelation<T extends Table> = {
  type: "many";
  fkColumn: string;
  table: () => T;
};

export type OneRelation<T extends Table> = {
  type: "one";
  fkColumn: string;
  table: () => T;
};

export type Relation<T extends Table = Table> =
  | ManyRelation<T>
  | OneRelation<T>;

// Extract relation names from a table
type RelationNames<T extends Table> =
  T extends Table<any, infer Rels> ? keyof Rels : never;

// Helper type to determine if a relation returns an array or single value
type RelationResult<T extends Table, K extends string> = T extends Table<
  any,
  infer Rels
>
  ? K extends keyof Rels
    ? Rels[K] extends ManyRelation<infer Target>
      ? InferTableType<Target>[]
      : Rels[K] extends OneRelation<infer Target>
        ? InferTableType<Target> | undefined
        : never
    : never
  : never;

// Build include options with only valid relation names
export type IncludeOptions<T extends Table> = {
  [K in RelationNames<T>]?: boolean;
};

// Merge a result type with included relations
export type WithIncluded<
  Base,
  T extends Table,
  Include extends Record<string, boolean> | undefined,
> = Include extends undefined
  ? Base
  : Include extends Record<string, boolean>
    ? Base & {
        [K in keyof Include as Include[K] extends true
          ? K
          : never]: RelationResult<T, K & string>;
      }
    : Base;
