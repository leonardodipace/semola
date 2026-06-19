import type { Table } from "../table/types.js";
import type {
  HasManyCandidate,
  HasOneCandidate,
  ResolveHasOneForeignKeyColumnInput,
} from "./types.js";

export class ForeignKeyResolver {
  public resolveHasMany(sourceTable: Table, targetTable: Table) {
    const sourceColumnValues = Object.values(sourceTable.columns);
    const candidates: HasManyCandidate[] = [];

    for (const [, column] of Object.entries(targetTable.columns)) {
      if (!column.references) continue;

      const getReferencedColumn = column.references.tableColumn;

      if (!getReferencedColumn) continue;

      const referencedColumn = getReferencedColumn();
      const referencesSourceColumn = sourceColumnValues.some((sourceCol) => {
        return sourceCol === referencedColumn;
      });

      if (referencesSourceColumn) {
        candidates.push({ fk: column, source: referencedColumn });
      }
    }

    if (candidates.length > 1) {
      throw new Error(
        `Ambiguous hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
      );
    }

    const [candidate] = candidates;

    if (!candidate) {
      throw new Error(
        `Missing hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
      );
    }

    return candidate;
  }

  public resolveHasOne(input: ResolveHasOneForeignKeyColumnInput) {
    const { sourceTable, relationTable, relationForeignKey } = input;
    const localForeignKey = sourceTable.columns[relationForeignKey];

    if (!localForeignKey) {
      throw new Error(
        `Missing hasOne foreign key column ${relationForeignKey} on ${sourceTable.sqlName}`,
      );
    }

    if (!localForeignKey.references?.tableColumn) {
      throw new Error(
        `Column ${relationForeignKey} on ${sourceTable.sqlName} is not a foreign key - call .references() on it`,
      );
    }

    const referencedColumn = localForeignKey.references.tableColumn();
    const relationColumns = Object.values(relationTable.columns);
    const referencesRelationTable = relationColumns.some((column) => {
      return column === referencedColumn;
    });

    if (!referencesRelationTable) {
      throw new Error(
        `Column ${relationForeignKey} on ${sourceTable.sqlName} does not reference ${relationTable.sqlName}`,
      );
    }

    const result: HasOneCandidate = {
      localForeignKey,
      target: referencedColumn,
    };

    return result;
  }
}

export const foreignKeyResolver = new ForeignKeyResolver();
