import type {
  FindManyOptions,
  FindManyResult,
  FindUniqueOptions,
  FindUniqueResult,
  TableRelations,
} from "../orm/types.js";
import type { Table } from "../table/types.js";

export type Adapter = Bun.SQL["options"]["adapter"];

export type Dialect<
  T extends Table = Table,
  TRelations extends TableRelations = TableRelations,
> = {
  name: Adapter;
  findMany<const TOptions extends FindManyOptions<T, TRelations>>(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TRelations, TOptions>>>;

  findUnique<const TOptions extends FindUniqueOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<FindUniqueResult<T, TRelations, TOptions>>;
};
