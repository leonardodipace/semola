import { SQLITE_SPEC } from "../dialect/sqlite.js";
import { MigrationError } from "../errors.js";
import { MigrationDialect } from "./dialect.js";
import type { ColumnSnapshot, MigrationOp } from "./types.js";

export class SqliteMigrationDialect extends MigrationDialect {
  public readonly name = "sqlite" as const;
  protected readonly uuidType = "TEXT";
  protected readonly sqlTypes = {
    string: "TEXT",
    enum: "TEXT",
    number: "REAL",
    boolean: "INTEGER",
    date: "TEXT",
    json: "TEXT",
    jsonb: "TEXT",
  };

  public formatPlaceholder(index: number) {
    return SQLITE_SPEC.formatPlaceholder(index);
  }

  public override sqlTypeFor(column: ColumnSnapshot) {
    if (column.type === "number") {
      if (column.isPrimaryKey) {
        return "INTEGER";
      }
    }

    return super.sqlTypeFor(column);
  }

  public override beginMigration<T>(
    sql: Bun.SQL,
    fn: (tx: Bun.SQL) => Promise<T>,
  ) {
    return sql.begin("IMMEDIATE", fn);
  }

  public override async prepareConnection(sql: Bun.SQL) {
    await sql.unsafe("PRAGMA foreign_keys = OFF");
  }

  public override async assertForeignKeys(sql: Bun.SQL) {
    const violations = [...(await sql.unsafe("PRAGMA foreign_key_check"))];

    if (violations.length === 0) return;

    throw new MigrationError(
      `Foreign key check failed (${violations.length} violation(s)): ${violations.map((row) => JSON.stringify(row)).join("; ")}`,
    );
  }

  protected override shouldRecreate(tableOps: MigrationOp[]) {
    if (tableOps.length === 0) return false;

    return !tableOps.every((op) => this.canApplyInPlace(op));
  }

  private canApplyInPlace(op: MigrationOp) {
    if (op.kind === "dropColumn") {
      if (op.column.isPrimaryKey) return false;
      if (op.column.isUnique) return false;

      return true;
    }

    if (op.kind !== "addColumn") return false;
    if (op.column.isPrimaryKey) return false;
    if (op.column.isUnique) return false;
    if (!op.column.isNullable && op.column.dbDefault === undefined) {
      return false;
    }

    return true;
  }
}
