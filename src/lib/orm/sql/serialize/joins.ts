import type { SQL, TransactionSQL } from "bun";
import {
  findManyForeignKeyByReference,
  getPrimaryKeyColumn,
} from "../../internal/table.js";
import type { Table } from "../../table.js";
import type { ColDefs, RelationDefs, SelectPlan } from "../../types.js";

export function buildJoinClauses<T extends ColDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: RelationDefs,
  plan: SelectPlan<T>,
) {
  if (plan.joins.length === 0) {
    return sql``;
  }

  let joinClause = sql``;
  const basePk = getPrimaryKeyColumn(table);

  if (!basePk) {
    return joinClause;
  }

  for (const [joinIndex, join] of plan.joins.entries()) {
    const rel = relations[join.relationKey];

    if (!rel) {
      continue;
    }

    const target = rel.table();
    const targetPk = getPrimaryKeyColumn(target);

    if (!targetPk) {
      continue;
    }

    const targetAlias = `${join.relationKey}_${joinIndex}`;

    if (rel.kind === "one") {
      joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} AS ${sql(targetAlias)} ON ${sql(table.tableName)}.${sql(rel.foreignKey)} = ${sql(targetAlias)}.${sql(targetPk.col.meta.sqlName)}`;
      continue;
    }

    let foreignSqlName = rel.foreignKey;

    if (!foreignSqlName) {
      const inferredForeignSqlName = findManyForeignKeyByReference(
        target,
        basePk.col,
      );

      if (inferredForeignSqlName) {
        foreignSqlName = inferredForeignSqlName;
      }
    }

    if (!foreignSqlName) {
      continue;
    }

    joinClause = sql`${joinClause} LEFT JOIN ${sql(target.tableName)} AS ${sql(targetAlias)} ON ${sql(targetAlias)}.${sql(foreignSqlName)} = ${sql(table.tableName)}.${sql(basePk.col.meta.sqlName)}`;
  }

  return joinClause;
}
