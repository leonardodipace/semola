import type { IntrospectedTable } from "../types.js";

import {
  toCamelCase,
  toOneRelationBaseName,
  toUniqueRelationKey,
  toVarName,
} from "./naming.js";

function findTableByName(tables: IntrospectedTable[], tableName: string) {
  for (const table of tables) {
    if (table.name === tableName) {
      return table;
    }
  }

  return null;
}

function buildRelationEntriesForTable(
  table: IntrospectedTable,
  tables: IntrospectedTable[],
) {
  const used = new Set<string>();
  const entries: string[] = [];

  for (const col of table.columns) {
    if (!col.references) {
      continue;
    }

    const targetTable = findTableByName(tables, col.references.table);

    if (!targetTable) {
      continue;
    }

    const oneKeyBase = toCamelCase(toOneRelationBaseName(col.sqlName));
    const oneKey = toUniqueRelationKey(oneKeyBase, used, col.sqlName);

    entries.push(
      `      ${oneKey}: one("${col.sqlName}", () => ${toVarName(targetTable.name)}),`,
    );
  }

  for (const sourceTable of tables) {
    for (const sourceCol of sourceTable.columns) {
      if (!sourceCol.references) {
        continue;
      }

      if (sourceCol.references.table !== table.name) {
        continue;
      }

      const manyKeyBase = toCamelCase(sourceTable.name);
      const manyKey = toUniqueRelationKey(manyKeyBase, used, sourceCol.sqlName);

      entries.push(
        `      ${manyKey}: many(() => ${toVarName(sourceTable.name)}, "${sourceCol.sqlName}"),`,
      );
    }
  }

  return entries;
}

export function hasAnyRelations(tables: IntrospectedTable[]) {
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.references) {
        return true;
      }
    }
  }

  return false;
}

export function buildRelationsConfig(tables: IntrospectedTable[]) {
  const lines: string[] = [];

  for (const table of tables) {
    const relationEntries = buildRelationEntriesForTable(table, tables);

    if (relationEntries.length === 0) {
      continue;
    }

    if (lines.length === 0) {
      lines.push("  relations: {");
    }

    lines.push(`    ${toCamelCase(table.name)}: {`);

    for (const relationEntry of relationEntries) {
      lines.push(relationEntry);
    }

    lines.push("    },");
  }

  if (lines.length === 0) {
    return null;
  }

  lines.push("  },");

  return lines.join("\n");
}
