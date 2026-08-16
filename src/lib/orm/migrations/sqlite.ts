import { SQLITE_SPEC } from "../dialect/sqlite.js";
import { MigrationDialect } from "./dialect.js";
import type { MigrationOp } from "./types.js";

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

  public override async prepareConnection(sql: Bun.SQL) {
    await sql.unsafe("PRAGMA foreign_keys = OFF");
  }

  protected override shouldRecreate(tableOps: MigrationOp[]) {
    if (tableOps.length === 0) return false;

    return !tableOps.every((op) => this.canApplyInPlace(op));
  }

  private canApplyInPlace(op: MigrationOp) {
    if (op.kind === "dropColumn") return true;
    if (op.kind !== "addColumn") return false;
    if (op.column.isPrimaryKey) return false;
    if (op.column.isUnique) return false;
    if (!op.column.isNullable && op.column.dbDefault === undefined) {
      return false;
    }

    return true;
  }
}
