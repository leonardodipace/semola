import type { SQL, TransactionSQL } from "bun";
import { serializeSelectInput } from "../../sql/serialize.js";
import type { Table } from "../../table.js";
import type {
  ColDefs,
  DialectAdapter,
  FindManyInput,
  RelationDefs,
} from "../../types.js";

export function mapFindInputToSelect<
  T extends ColDefs,
  TRels extends RelationDefs,
>(input?: FindManyInput<T, TRels>) {
  if (!input) {
    return {};
  }

  return {
    where: input.where,
    include: input.include,
    orderBy: input.orderBy,
    limit: input.take,
    offset: input.skip,
  };
}

export function createSelectQuery<
  T extends ColDefs,
  TRels extends RelationDefs,
>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: TRels,
  input: object,
  dialectAdapter: DialectAdapter,
) {
  return serializeSelectInput(sql, table, relations, input, dialectAdapter);
}
