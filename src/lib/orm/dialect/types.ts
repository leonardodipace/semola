import type {
  FindManyOptions,
  FindManyResult,
  TableRelations,
} from "../orm/types.js";
import type { Table } from "../table/types.js";

export type Adapter = Bun.SQL["options"]["adapter"];

export type Dialect<T extends Table = Table> = {
  name: Adapter;
  findMany<
    const TRelations extends TableRelations,
    const TOptions extends FindManyOptions<T, TRelations>,
  >(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TRelations, TOptions>>>;
};
