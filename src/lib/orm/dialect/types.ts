import type { FindManyOptions, TableRow } from "../orm/types.js";
import type { Table } from "../table/types.js";

export type Adapter = Bun.SQL["options"]["adapter"];

export type Dialect<T extends Table = Table> = {
  name: Adapter;
  findMany: (
    sql: Bun.SQL,
    options?: FindManyOptions<T>,
  ) => Promise<Array<TableRow<T>>>;
};
