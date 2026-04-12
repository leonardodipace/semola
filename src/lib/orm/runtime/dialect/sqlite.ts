import type { ColDefs, RelationDefs } from "../../types.js";
import { PostgresDialect } from "./postgres.js";

export class SqliteDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
> extends PostgresDialect<T, TRels> {}
