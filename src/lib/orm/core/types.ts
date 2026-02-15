import type { Relation } from "../relations/types.js";
import type { Table, TableClient } from "../table/index.js";

export type OrmOptions<
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>> = {},
> = {
  url: string;
  tables: Tables;
  relations?: Relations;
};

export type TableClients<
  Tables extends Record<string, Table>,
  Relations extends Record<string, Record<string, Relation>> = {},
> = {
  [K in keyof Tables]: K extends keyof Relations
    ? Tables[K] extends Table<infer Cols, any>
      ? TableClient<Table<Cols, Relations[K]>>
      : TableClient<Tables[K]>
    : TableClient<Tables[K]>;
};
