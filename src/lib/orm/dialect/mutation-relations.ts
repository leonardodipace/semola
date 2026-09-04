import type { Column } from "../column/types.js";
import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import { foreignKeyResolver } from "./foreign-key.js";
import { PlaceholderGenerator } from "./placeholder.js";
import {
  serializeColumnValue,
  validateFindUniqueWhere,
} from "./sql-helpers.js";
import type {
  DialectSpec,
  ParsedRelationWrite,
  RelationMutationContext,
} from "./types.js";

const REL_KEYS = new Set(["connect", "disconnect"]);

const isRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const whereObject = (relationName: string, value: unknown) => {
  if (!isRecord(value)) {
    throw new Error(
      `connect/disconnect entry for ${relationName} must be a unique where object`,
    );
  }

  return value as Record<string, unknown>;
};

const parseWrite = (
  relationName: string,
  value: unknown,
): ParsedRelationWrite => {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid relation write for ${relationName}: expected an object with connect or disconnect`,
    );
  }

  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !REL_KEYS.has(key));

  if (unknown.length) {
    throw new Error(
      `Relation write for ${relationName} has unknown operators: ${unknown.join(", ")}`,
    );
  }

  const connect = record.connect;
  const disconnect = record.disconnect;

  if (connect === undefined) {
    if (disconnect === undefined) {
      throw new Error(
        `Relation write for ${relationName} must include connect or disconnect`,
      );
    }
  }

  if (connect === null)
    throw new Error(`connect for ${relationName} cannot be null`);
  if (disconnect === null) {
    throw new Error(`disconnect for ${relationName} cannot be null`);
  }

  const write: ParsedRelationWrite = { relationName };

  if (connect !== undefined) {
    write.connect = Array.isArray(connect)
      ? connect.map((entry) => whereObject(relationName, entry))
      : whereObject(relationName, connect);
  }

  if (disconnect === undefined) return write;

  if (disconnect === true) {
    write.disconnect = true;
    return write;
  }

  if (!Array.isArray(disconnect)) {
    throw new Error(
      `disconnect for ${relationName} must be true or an array of unique where objects`,
    );
  }

  write.disconnect = disconnect.map((entry) =>
    whereObject(relationName, entry),
  );
  return write;
};

export const splitMutationData = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  data: Record<string, unknown>,
) => {
  const columnData: Record<string, unknown> = {};
  const relationWrites: ParsedRelationWrite[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    if (key in relations) {
      relationWrites.push(parseWrite(key, value));
      continue;
    }

    if (!table.columns[key]) {
      throw new Error(`Unknown data key "${key}" on table ${table.sqlName}`);
    }

    columnData[key] = value;
  }

  return { columnData, relationWrites };
};

export const assertNoForeignKeyConflicts = (
  relations: TableRelations,
  columnData: Record<string, unknown>,
  relationWrites: ParsedRelationWrite[],
) => {
  for (const write of relationWrites) {
    const relation = relations[write.relationName];

    if (!relation) continue;
    if (relation._type !== "hasOne") continue;
    if (!write.connect) {
      if (!write.disconnect) continue;
    }
    if (!(relation._foreignKey in columnData)) continue;

    throw new Error(
      `Cannot set ${relation._foreignKey} and nested ${write.relationName} write in the same mutation`,
    );
  }
};

const pkColumn = (table: Table) => {
  for (const column of Object.values(table.columns)) {
    if (column._meta.isPrimaryKey) return column;
  }

  throw new Error(`Table ${table.sqlName} is missing a primary key column`);
};

const rowValue = (
  table: Table,
  column: { sqlName: string },
  row: Record<string, unknown>,
) => {
  for (const [key, entry] of Object.entries(table.columns)) {
    if (entry.sqlName !== column.sqlName) continue;
    if (key in row) return row[key];
  }

  return row[column.sqlName];
};

export const primaryKeyValueFromRow = (
  table: Table,
  row: Record<string, unknown>,
  where?: Record<string, unknown>,
) => {
  const pk = pkColumn(table);

  for (const [key, column] of Object.entries(table.columns)) {
    if (column !== pk) continue;
    if (where?.[key] !== undefined) return where[key];

    const value = row[key];
    if (value !== undefined) return value;
  }

  throw new Error(
    `Missing primary key value for table ${table.sqlName} during relation write`,
  );
};

const findRow = async (
  sql: Bun.SQL,
  spec: DialectSpec,
  table: Table,
  where: Record<string, unknown>,
  relationName: string,
) => {
  const fields = Object.entries(where).filter(
    ([, value]) => value !== undefined,
  );

  if (fields.length !== 1) {
    throw new Error(
      `connect for ${relationName} must include exactly one unique where field`,
    );
  }

  validateFindUniqueWhere(table, where);

  const placeholders = new PlaceholderGenerator(spec);
  const next = placeholders.asFn();
  const params: unknown[] = [];
  const clauses: string[] = [];

  for (const [key, value] of fields) {
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

    clauses.push(`${quoteIdentifier(column.sqlName)} = ${next()}`);
    params.push(serializeColumnValue(column, value));
  }

  const statement = `SELECT * FROM ${quoteIdentifier(table.sqlName)} WHERE ${clauses.join(" AND ")} LIMIT 1`;
  const rows = await sql.unsafe(statement, params);

  if (!rows[0]) {
    throw new Error(
      `Record to connect not found on table ${table.sqlName} for ${JSON.stringify(where)}`,
    );
  }

  return rows[0] as Record<string, unknown>;
};

const rowsAt = async (
  ctx: RelationMutationContext,
  table: Table,
  wheres: Array<Record<string, unknown>>,
  relationName: string,
) => {
  const rows: Array<Record<string, unknown>> = [];

  for (const where of wheres) {
    rows.push(await findRow(ctx.sql, ctx.spec, table, where, relationName));
  }

  return rows;
};

const setChildLinks = async (
  sql: Bun.SQL,
  spec: DialectSpec,
  table: Table,
  fk: Column,
  childIds: unknown[],
  value: unknown,
  parentKey?: unknown,
) => {
  const pk = pkColumn(table);
  const placeholders = new PlaceholderGenerator(spec);
  const next = placeholders.asFn();
  const set = next();
  const params = [serializeColumnValue(fk, value)];
  const ids: string[] = [];

  for (const childId of childIds) {
    ids.push(next());
    params.push(serializeColumnValue(pk, childId));
  }

  let statement = `UPDATE ${quoteIdentifier(table.sqlName)} SET ${quoteIdentifier(fk.sqlName)} = ${set} WHERE ${quoteIdentifier(pk.sqlName)} IN (${ids.join(", ")})`;

  if (value === null) {
    const owner = next();
    statement += ` AND ${quoteIdentifier(fk.sqlName)} = ${owner}`;
    params.push(serializeColumnValue(fk, parentKey));
  }

  const updated = await sql.unsafe(
    `${statement} RETURNING ${quoteIdentifier(pk.sqlName)}`,
    params,
  );

  if (updated.length !== childIds.length) {
    throw new Error(`Failed to update all records on ${table.sqlName}`);
  }
};

const relation = (ctx: RelationMutationContext, name: string) => {
  const entry = ctx.relations[name];

  if (!entry) {
    throw new Error(
      `Unknown relation ${name} on table ${ctx.parentTable.sqlName}`,
    );
  }

  return entry;
};

export const resolveHasOneColumns = async (ctx: RelationMutationContext) => {
  const columnData: Record<string, unknown> = {};

  for (const write of ctx.relationWrites) {
    const rel = relation(ctx, write.relationName);

    if (rel._type !== "hasOne") continue;

    if (write.connect) {
      if (write.disconnect) {
        throw new Error(
          `Relation write for ${write.relationName} cannot include both connect and disconnect`,
        );
      }
    }

    const { localForeignKey, target } = foreignKeyResolver.resolveHasOne({
      sourceTable: ctx.parentTable,
      relationTable: rel._table,
      relationForeignKey: rel._foreignKey,
    });

    if (write.connect) {
      if (Array.isArray(write.connect)) {
        throw new Error(
          `connect for hasOne relation ${write.relationName} must be a unique where object`,
        );
      }

      const row = await findRow(
        ctx.sql,
        ctx.spec,
        rel._table,
        write.connect,
        write.relationName,
      );

      columnData[rel._foreignKey] = rowValue(rel._table, target, row);
    }

    if (write.disconnect) {
      if (write.disconnect !== true) {
        throw new Error(
          `disconnect for hasOne relation ${write.relationName} must be true`,
        );
      }

      if (!localForeignKey._meta.isNullable) {
        throw new Error(
          `disconnect is only valid on optional relation ${write.relationName}`,
        );
      }

      columnData[rel._foreignKey] = null;
    }
  }

  return columnData;
};

export const runHasManyWrites = async (ctx: RelationMutationContext) => {
  let ran = false;

  for (const write of ctx.relationWrites) {
    const rel = relation(ctx, write.relationName);

    if (rel._type !== "hasMany") continue;

    const { fk } = foreignKeyResolver.resolveHasMany(
      ctx.parentTable,
      rel._table,
    );
    const childTable = rel._table;
    const pk = pkColumn(childTable);

    if (write.connect) {
      if (!Array.isArray(write.connect)) {
        throw new Error(
          `connect for hasMany relation ${write.relationName} must be an array of unique where objects`,
        );
      }

      const rows = await rowsAt(
        ctx,
        childTable,
        write.connect,
        write.relationName,
      );

      for (const row of rows) {
        const owner = rowValue(childTable, fk, row);

        if (owner === null) continue;
        if (owner === undefined) continue;
        if (owner === ctx.parentKey) continue;

        throw new Error(
          `Record on ${childTable.sqlName} is already linked to another parent`,
        );
      }

      const childIds = [
        ...new Set(rows.map((row) => rowValue(childTable, pk, row))),
      ];

      if (!childIds.length) continue;

      await setChildLinks(
        ctx.sql,
        ctx.spec,
        childTable,
        fk,
        childIds,
        ctx.parentKey,
      );
      ran = true;
    }

    if (write.disconnect) {
      if (!fk._meta.isNullable) {
        throw new Error(
          `disconnect is only valid on optional relation ${write.relationName}`,
        );
      }

      if (write.disconnect === true) {
        throw new Error(
          `disconnect for hasMany relation ${write.relationName} must be an array of unique where objects`,
        );
      }

      const rows = await rowsAt(
        ctx,
        childTable,
        write.disconnect,
        write.relationName,
      );
      const childIds = [
        ...new Set(rows.map((row) => rowValue(childTable, pk, row))),
      ];

      if (!childIds.length) continue;

      await setChildLinks(
        ctx.sql,
        ctx.spec,
        childTable,
        fk,
        childIds,
        null,
        ctx.parentKey,
      );
      ran = true;
    }
  }

  return ran;
};
