import type { FindManyOptions, FindManyResult } from "../orm/types.js";
import type { Table } from "../table/types.js";

export type Adapter = Bun.SQL["options"]["adapter"];

export type Dialect<T extends Table = Table> = {
  name: Adapter;
  findMany<const TOptions extends FindManyOptions<T>>(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TOptions>>>;
};
