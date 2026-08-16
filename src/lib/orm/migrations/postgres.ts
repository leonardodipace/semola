import { POSTGRES_SPEC } from "../dialect/postgres.js";
import { quoteIdentifier } from "../utils.js";
import { MigrationDialect } from "./dialect.js";
import type { ColumnSnapshot } from "./types.js";

export class PostgresMigrationDialect extends MigrationDialect {
  public readonly name = "postgres" as const;
  protected readonly uuidType = "UUID";
  protected readonly sqlTypes = {
    string: "TEXT",
    enum: "TEXT",
    number: "DOUBLE PRECISION",
    boolean: "BOOLEAN",
    date: "TIMESTAMP",
    json: "JSON",
    jsonb: "JSONB",
  };

  public formatPlaceholder(index: number) {
    return POSTGRES_SPEC.formatPlaceholder(index);
  }

  protected override renderAlterColumn(
    table: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    const statements: string[] = [];
    const tableId = quoteIdentifier(table);
    const columnId = quoteIdentifier(to.name);
    const alterColumn = (action: string) => {
      statements.push(
        `ALTER TABLE ${tableId} ALTER COLUMN ${columnId} ${action};`,
      );
    };

    if (from.type !== to.type || from.sqlType !== to.sqlType) {
      alterColumn(`TYPE ${this.sqlTypeFor(to)}`);
    }

    if (from.isNullable !== to.isNullable) {
      alterColumn(to.isNullable ? "DROP NOT NULL" : "SET NOT NULL");
    }

    if (from.dbDefault !== to.dbDefault) {
      if (to.dbDefault === undefined) {
        alterColumn("DROP DEFAULT");
      } else {
        alterColumn(`SET DEFAULT ${to.dbDefault}`);
      }
    }

    this.pushUniqueChange(statements, table, tableId, columnId, from, to);
    this.pushPrimaryKeyChange(statements, table, tableId, columnId, from, to);
    this.pushForeignKeyChange(statements, table, tableId, columnId, from, to);
    this.pushEnumCheckChange(statements, table, tableId, from, to);

    if (statements.length === 0) {
      return `-- no-op alter for ${table}.${to.name}`;
    }

    return statements.join("\n");
  }

  private jsonEqual(a: unknown, b: unknown) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private pushUniqueChange(
    statements: string[],
    table: string,
    tableId: string,
    columnId: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    if (from.isUnique === to.isUnique) return;
    if (to.isPrimaryKey) return;
    if (from.isPrimaryKey) return;

    if (to.isUnique) {
      statements.push(`ALTER TABLE ${tableId} ADD UNIQUE (${columnId});`);
      return;
    }

    statements.push(
      `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_${to.name}_key`)};`,
    );
  }

  private pushPrimaryKeyChange(
    statements: string[],
    table: string,
    tableId: string,
    columnId: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    if (from.isPrimaryKey === to.isPrimaryKey) return;

    if (to.isPrimaryKey) {
      statements.push(`ALTER TABLE ${tableId} ADD PRIMARY KEY (${columnId});`);
      return;
    }

    statements.push(
      `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_pkey`)};`,
    );
  }

  private pushForeignKeyChange(
    statements: string[],
    table: string,
    tableId: string,
    columnId: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    if (this.jsonEqual(from.references, to.references)) return;

    if (from.references) {
      statements.push(
        `ALTER TABLE ${tableId} DROP CONSTRAINT ${quoteIdentifier(`${table}_${from.name}_fkey`)};`,
      );
    }

    if (to.references) {
      statements.push(
        `ALTER TABLE ${tableId} ADD FOREIGN KEY (${columnId}) REFERENCES ${quoteIdentifier(to.references.table)} (${quoteIdentifier(to.references.column)});`,
      );
    }
  }

  private pushEnumCheckChange(
    statements: string[],
    table: string,
    tableId: string,
    from: ColumnSnapshot,
    to: ColumnSnapshot,
  ) {
    if (this.jsonEqual(from.enumValues, to.enumValues)) return;

    const checkName = quoteIdentifier(`${table}_${to.name}_check`);

    if (from.enumValues?.length) {
      statements.push(`ALTER TABLE ${tableId} DROP CONSTRAINT ${checkName};`);
    }

    const check = this.enumCheckSql(to);

    if (check) {
      statements.push(
        `ALTER TABLE ${tableId} ADD CONSTRAINT ${checkName} ${check};`,
      );
    }
  }
}
