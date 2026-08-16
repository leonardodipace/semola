import type { Adapter } from "../dialect/types.js";
import { quoteIdentifier } from "../utils.js";
import type {
  ColumnSnapshot,
  MigrationOp,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.js";

const SCHEMA_HEADER_PREFIX = "-- semola-schema:";

export const encodeSchemaHeader = (schema: SchemaSnapshot) => {
  return `${SCHEMA_HEADER_PREFIX}${JSON.stringify(schema)}`;
};

export const decodeSchemaHeader = (sql: string) => {
  const firstLine = sql.split("\n")[0] ?? "";

  if (!firstLine.startsWith(SCHEMA_HEADER_PREFIX)) {
    return undefined;
  }

  return JSON.parse(
    firstLine.slice(SCHEMA_HEADER_PREFIX.length),
  ) as SchemaSnapshot;
};

const sqlTypeFor = (adapter: Adapter, column: ColumnSnapshot) => {
  if (column.sqlType === "uuid") {
    if (adapter === "postgres") return "UUID";

    return "TEXT";
  }

  switch (column.type) {
    case "string":
    case "enum":
      return "TEXT";
    case "number":
      if (adapter === "postgres") return "DOUBLE PRECISION";

      return "REAL";
    case "boolean":
      if (adapter === "postgres") return "BOOLEAN";

      return "INTEGER";
    case "date":
      if (adapter === "postgres") return "TIMESTAMP";

      return "TEXT";
    case "json":
      if (adapter === "postgres") return "JSON";

      return "TEXT";
    case "jsonb":
      if (adapter === "postgres") return "JSONB";

      return "TEXT";
    default:
      return "TEXT";
  }
};

const columnInlineConstraints = (
  adapter: Adapter,
  column: ColumnSnapshot,
  forCreateTable: boolean,
) => {
  const parts: string[] = [sqlTypeFor(adapter, column)];

  if (column.isPrimaryKey && forCreateTable) {
    parts.push("PRIMARY KEY");
  }

  if (!column.isNullable) {
    parts.push("NOT NULL");
  }

  if (column.isUnique && !column.isPrimaryKey) {
    parts.push("UNIQUE");
  }

  if (column.dbDefault !== undefined) {
    parts.push(`DEFAULT ${column.dbDefault}`);
  }

  if (column.enumValues?.length) {
    const list = column.enumValues
      .map((value) => `'${value.replaceAll("'", "''")}'`)
      .join(", ");

    parts.push(`CHECK (${quoteIdentifier(column.name)} IN (${list}))`);
  }

  if (column.references && forCreateTable) {
    parts.push(
      `REFERENCES ${quoteIdentifier(column.references.table)} (${quoteIdentifier(column.references.column)})`,
    );
  }

  return parts.join(" ");
};

const renderColumnDef = (
  adapter: Adapter,
  column: ColumnSnapshot,
  forCreateTable: boolean,
) => {
  return `${quoteIdentifier(column.name)} ${columnInlineConstraints(adapter, column, forCreateTable)}`;
};

const sortTablesForCreate = (tables: TableSnapshot[]) => {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: TableSnapshot[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;

    visiting.add(name);
    const table = byName.get(name);

    if (table) {
      for (const column of Object.values(table.columns)) {
        if (!column.references) continue;
        if (!byName.has(column.references.table)) continue;

        visit(column.references.table);
      }

      ordered.push(table);
    }

    visiting.delete(name);
    visited.add(name);
  };

  for (const table of tables) {
    visit(table.name);
  }

  return ordered;
};

const renderCreateTable = (adapter: Adapter, table: TableSnapshot) => {
  const lines = Object.values(table.columns).map((column) => {
    return `    ${renderColumnDef(adapter, column, true)}`;
  });

  return `CREATE TABLE ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);`;
};

const renderDropTable = (table: TableSnapshot) => {
  return `DROP TABLE ${quoteIdentifier(table.name)};`;
};

const renderAddColumn = (
  adapter: Adapter,
  table: string,
  column: ColumnSnapshot,
) => {
  let sql = `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${renderColumnDef(adapter, column, false)};`;

  if (column.references) {
    if (adapter === "postgres") {
      sql += `\nALTER TABLE ${quoteIdentifier(table)} ADD FOREIGN KEY (${quoteIdentifier(column.name)}) REFERENCES ${quoteIdentifier(column.references.table)} (${quoteIdentifier(column.references.column)});`;
    }
  }

  return sql;
};

const renderDropColumn = (table: string, column: ColumnSnapshot) => {
  return `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(column.name)};`;
};

const renderAlterColumnPostgres = (
  table: string,
  from: ColumnSnapshot,
  to: ColumnSnapshot,
) => {
  const statements: string[] = [];
  const tableId = quoteIdentifier(table);
  const columnId = quoteIdentifier(to.name);

  if (
    from.type !== to.type ||
    from.sqlType !== to.sqlType ||
    JSON.stringify(from.enumValues) !== JSON.stringify(to.enumValues)
  ) {
    statements.push(
      `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} TYPE ${sqlTypeFor("postgres", to)};`,
    );
  }

  if (from.isNullable && !to.isNullable) {
    statements.push(
      `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} SET NOT NULL;`,
    );
  }

  if (!from.isNullable && to.isNullable) {
    statements.push(
      `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} DROP NOT NULL;`,
    );
  }

  if (from.dbDefault !== to.dbDefault) {
    if (to.dbDefault === undefined) {
      statements.push(
        `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} DROP DEFAULT;`,
      );
    } else {
      statements.push(
        `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} SET DEFAULT ${to.dbDefault};`,
      );
    }
  }

  if (!from.isUnique && to.isUnique && !to.isPrimaryKey) {
    statements.push(`ALTER TABLE ${tableId} ADD UNIQUE (${columnId});`);
  }

  if (from.isUnique && !to.isUnique && !from.isPrimaryKey) {
    statements.push(
      `ALTER TABLE ${tableId} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(`${table}_${to.name}_key`)};`,
    );
  }

  if (!from.isPrimaryKey && to.isPrimaryKey) {
    statements.push(`ALTER TABLE ${tableId} ADD PRIMARY KEY (${columnId});`);
  }

  if (from.isPrimaryKey && !to.isPrimaryKey) {
    statements.push(
      `ALTER TABLE ${tableId} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(`${table}_pkey`)};`,
    );
  }

  if (JSON.stringify(from.references) !== JSON.stringify(to.references)) {
    if (from.references) {
      statements.push(
        `ALTER TABLE ${tableId} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(`${table}_${from.name}_fkey`)};`,
      );
    }

    if (to.references) {
      statements.push(
        `ALTER TABLE ${tableId} ADD FOREIGN KEY (${columnId}) REFERENCES ${quoteIdentifier(to.references.table)} (${quoteIdentifier(to.references.column)});`,
      );
    }
  }

  if (statements.length === 0) {
    return `-- no-op alter for ${table}.${to.name}`;
  }

  return statements.join("\n");
};

const renderRecreateTable = (adapter: Adapter, to: TableSnapshot) => {
  return `${renderDropTable(to)}\n${renderCreateTable(adapter, to)}`;
};

const renderOp = (adapter: Adapter, op: MigrationOp) => {
  switch (op.kind) {
    case "createTable":
      return renderCreateTable(adapter, op.table);
    case "dropTable":
      return renderDropTable(op.table);
    case "addColumn":
      return renderAddColumn(adapter, op.table, op.column);
    case "dropColumn":
      return renderDropColumn(op.table, op.column);
    case "alterColumn":
      if (adapter === "postgres") {
        return renderAlterColumnPostgres(op.table, op.from, op.to);
      }

      return renderRecreateTable(adapter, {
        name: op.table,
        columns: { [op.to.name]: op.to },
      });
    case "recreateTable":
      return `${renderDropTable(op.from)}\n${renderCreateTable(adapter, op.to)}`;
  }
};

const orderOpsForExecution = (ops: MigrationOp[]) => {
  const createTables: TableSnapshot[] = [];
  const dropTables: TableSnapshot[] = [];
  const rest: MigrationOp[] = [];

  for (const op of ops) {
    if (op.kind === "createTable") {
      createTables.push(op.table);
      continue;
    }

    if (op.kind === "dropTable") {
      dropTables.push(op.table);
      continue;
    }

    rest.push(op);
  }

  const sortedCreates = sortTablesForCreate(createTables).map((table) => {
    return { kind: "createTable" as const, table };
  });

  const sortedDrops = sortTablesForCreate(dropTables)
    .reverse()
    .map((table) => {
      return { kind: "dropTable" as const, table };
    });

  return [...sortedDrops, ...rest, ...sortedCreates];
};

export const renderMigrationSql = (
  adapter: Adapter,
  ops: MigrationOp[],
  schemaHeader?: SchemaSnapshot,
) => {
  const ordered = orderOpsForExecution(ops);
  const body = ordered.map((op) => renderOp(adapter, op)).join("\n\n");

  if (!schemaHeader) {
    return `${body}\n`;
  }

  return `${encodeSchemaHeader(schemaHeader)}\n\n${body}\n`;
};
