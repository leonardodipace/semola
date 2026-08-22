import { SQLITE_SPEC } from "../../dialect/sqlite.js";
import { MigrationError } from "../../errors.js";
import type { ColumnSnapshot, MigrationOp } from "../types.js";
import { MigrationDialect } from "./dialect.js";

const isConstantDefault = (value: string) => {
  if (value === "TRUE") return true;
  if (value === "FALSE") return true;
  if (value === "NULL") return true;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return true;
  if (value.startsWith("'") && value.endsWith("'")) return true;

  return false;
};

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

  protected formatPlaceholder(index: number) {
    return SQLITE_SPEC.formatPlaceholder(index);
  }

  protected override formatDefault(value: string) {
    if (value === "TRUE") return "1";
    if (value === "FALSE") return "0";

    return value;
  }

  protected override sqlTypeFor(column: ColumnSnapshot) {
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
    await sql.unsafe("PRAGMA busy_timeout = 250");
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
    if (op.kind === "addColumn") {
      if (op.column.isPrimaryKey) return false;
      if (op.column.isUnique) return false;
      if (op.column.dbDefault !== undefined) {
        if (!isConstantDefault(op.column.dbDefault)) return false;
      } else if (!op.column.isNullable) {
        return false;
      }

      return true;
    }

    if (op.kind === "dropColumn") {
      if (op.column.isPrimaryKey) return false;
      if (op.column.isUnique) return false;

      return true;
    }

    return false;
  }
}
