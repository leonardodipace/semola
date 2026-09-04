import type { Column } from "../column/types.js";
import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import { foreignKeyResolver } from "./foreign-key.js";
import { PlaceholderGenerator } from "./placeholder.js";
import { serializeColumnValue } from "./sql-helpers.js";
import type { DialectSpec, ParsedRelationWrite } from "./types.js";

export type RelationMutationCtx = {
  sql: Bun.SQL;
  spec: DialectSpec;
  parent: Table;
  relations: TableRelations;
  writes: ParsedRelationWrite[];
  parentKey?: unknown;
  parentWhere?: Record<string, unknown>;
  read: (
    table: Table,
    where: Record<string, unknown>,
    name: string,
  ) => Promise<Record<string, unknown>>;
};

const REL = new Set(["connect", "disconnect"]);
const obj = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parse = (name: string, value: unknown): ParsedRelationWrite => {
  if (!obj(value)) {
    throw new Error(
      `Invalid relation write for ${name}: expected an object with connect or disconnect`,
    );
  }

  const data = value as Record<string, unknown>;
  const bad = Object.keys(data).filter((key) => !REL.has(key));

  if (bad.length) {
    throw new Error(
      `Relation write for ${name} has unknown operators: ${bad.join(", ")}`,
    );
  }

  const connect = data.connect;
  const disconnect = data.disconnect;

  if (connect === undefined && disconnect === undefined) {
    throw new Error(
      `Relation write for ${name} must include connect or disconnect`,
    );
  }

  if (connect === null) throw new Error(`connect for ${name} cannot be null`);
  if (disconnect === null)
    throw new Error(`disconnect for ${name} cannot be null`);

  const where = (entry: unknown) => {
    if (!obj(entry)) {
      throw new Error(
        `connect/disconnect entry for ${name} must be a unique where object`,
      );
    }

    return entry as Record<string, unknown>;
  };

  const write: ParsedRelationWrite = { relationName: name };

  if (connect !== undefined) {
    write.connect = Array.isArray(connect)
      ? connect.map(where)
      : where(connect);
  }

  if (disconnect === undefined) return write;
  if (disconnect === true) {
    write.disconnect = true;
    return write;
  }

  if (!Array.isArray(disconnect)) {
    throw new Error(
      `disconnect for ${name} must be true or an array of unique where objects`,
    );
  }

  write.disconnect = disconnect.map(where);
  return write;
};

export const splitMutationData = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  data: Record<string, unknown>,
) => {
  const columnData: Record<string, unknown> = {};
  const writes: ParsedRelationWrite[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    if (key in relations) {
      writes.push(parse(key, value));
      continue;
    }

    if (!table.columns[key]) {
      throw new Error(`Unknown data key "${key}" on table ${table.sqlName}`);
    }

    columnData[key] = value;
  }

  return { columnData, relationWrites: writes };
};

const pk = (table: Table) => {
  for (const column of Object.values(table.columns)) {
    if (column._meta.isPrimaryKey) return column;
  }

  throw new Error(`Table ${table.sqlName} is missing a primary key column`);
};

const val = (
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

export const parentKeyValue = (
  table: Table,
  row: Record<string, unknown>,
  where?: Record<string, unknown>,
) => {
  const column = pk(table);

  for (const [key, entry] of Object.entries(table.columns)) {
    if (entry !== column) continue;
    if (where?.[key] !== undefined) return where[key];

    const value = row[key];
    if (value !== undefined) return value;
  }

  throw new Error(
    `Missing primary key value for table ${table.sqlName} during relation write`,
  );
};

const patch = async (
  ctx: RelationMutationCtx,
  table: Table,
  fk: Column,
  ids: unknown[],
  value: unknown,
  owner?: unknown,
) => {
  const column = pk(table);
  const next = new PlaceholderGenerator(ctx.spec).asFn();
  const set = next();
  const params = [serializeColumnValue(fk, value)];
  const keys = ids.map((id) => {
    params.push(serializeColumnValue(column, id));
    return next();
  });
  let sql = `UPDATE ${quoteIdentifier(table.sqlName)} SET ${quoteIdentifier(fk.sqlName)} = ${set} WHERE ${quoteIdentifier(column.sqlName)} IN (${keys.join(", ")})`;

  if (value === null) {
    sql += ` AND ${quoteIdentifier(fk.sqlName)} = ${next()}`;
    params.push(serializeColumnValue(fk, owner));
  }

  const rows = await ctx.sql.unsafe(
    `${sql} RETURNING ${quoteIdentifier(column.sqlName)}`,
    params,
  );

  if (rows.length !== ids.length) {
    throw new Error(`Failed to update all records on ${table.sqlName}`);
  }
};

const assertFree = async (
  ctx: RelationMutationCtx,
  fk: Column,
  target: unknown,
  child: Table,
) => {
  if (ctx.parentWhere) {
    const parentRow = await ctx.read(ctx.parent, ctx.parentWhere, "parent");

    if (val(ctx.parent, fk, parentRow) === target) return;

    const column = pk(ctx.parent);
    const next = new PlaceholderGenerator(ctx.spec).asFn();
    const params = [serializeColumnValue(fk, target)];
    let sql = `SELECT 1 FROM ${quoteIdentifier(ctx.parent.sqlName)} WHERE ${quoteIdentifier(fk.sqlName)} = ${next()}`;
    sql += ` AND ${quoteIdentifier(column.sqlName)} != ${next()}`;
    params.push(
      serializeColumnValue(column, val(ctx.parent, column, parentRow)),
    );

    const rows = await ctx.sql.unsafe(`${sql} LIMIT 1`, params);

    if (!rows[0]) return;

    throw new Error(
      `Record on ${child.sqlName} is already linked to another parent`,
    );
  }

  const column = pk(ctx.parent);
  const next = new PlaceholderGenerator(ctx.spec).asFn();
  const params = [serializeColumnValue(fk, target)];
  const sql = `SELECT 1 FROM ${quoteIdentifier(ctx.parent.sqlName)} WHERE ${quoteIdentifier(fk.sqlName)} = ${next()}`;

  const rows = await ctx.sql.unsafe(`${sql} LIMIT 1`, params);

  if (!rows[0]) return;

  throw new Error(
    `Record on ${child.sqlName} is already linked to another parent`,
  );
};

export const applyRelationMutations = async (ctx: RelationMutationCtx) => {
  const patches: Record<string, unknown> = {};
  let ranMany = false;

  for (const write of ctx.writes) {
    const rel = ctx.relations[write.relationName];

    if (!rel) {
      throw new Error(
        `Unknown relation ${write.relationName} on table ${ctx.parent.sqlName}`,
      );
    }

    if (rel._type === "hasOne" && ctx.parentKey === undefined) {
      if (write.connect && write.disconnect) {
        throw new Error(
          `Relation write for ${write.relationName} cannot include both connect and disconnect`,
        );
      }

      const link = foreignKeyResolver.resolveHasOne({
        sourceTable: ctx.parent,
        relationTable: rel._table,
        relationForeignKey: rel._foreignKey,
      });

      if (write.connect) {
        if (Array.isArray(write.connect)) {
          throw new Error(
            `connect for hasOne relation ${write.relationName} must be a unique where object`,
          );
        }

        const row = await ctx.read(
          rel._table,
          write.connect,
          write.relationName,
        );
        const target = val(rel._table, link.target, row);

        await assertFree(ctx, link.localForeignKey, target, rel._table);

        patches[rel._foreignKey] = target;
      }

      if (write.disconnect) {
        if (write.disconnect !== true) {
          throw new Error(
            `disconnect for hasOne relation ${write.relationName} must be true`,
          );
        }

        if (!link.localForeignKey._meta.isNullable) {
          throw new Error(
            `disconnect is only valid on optional relation ${write.relationName}`,
          );
        }

        patches[rel._foreignKey] = null;
      }

      continue;
    }

    if (rel._type !== "hasMany" || ctx.parentKey === undefined) continue;

    const link = foreignKeyResolver.resolveHasMany(ctx.parent, rel._table);
    const child = rel._table;
    const column = pk(child);
    const load = (list: Array<Record<string, unknown>>) =>
      Promise.all(
        list.map((where) => ctx.read(child, where, write.relationName)),
      );

    if (write.connect) {
      if (!Array.isArray(write.connect)) {
        throw new Error(
          `connect for hasMany relation ${write.relationName} must be an array of unique where objects`,
        );
      }

      const rows = await load(write.connect);

      for (const row of rows) {
        const owner = val(child, link.fk, row);

        if (owner === null) continue;
        if (owner === undefined) continue;
        if (owner === ctx.parentKey) continue;

        throw new Error(
          `Record on ${child.sqlName} is already linked to another parent`,
        );
      }

      const ids = [...new Set(rows.map((row) => val(child, column, row)))];

      if (ids.length) {
        await patch(ctx, child, link.fk, ids, ctx.parentKey);
        ranMany = true;
      }
    }

    if (write.disconnect) {
      if (!link.fk._meta.isNullable) {
        throw new Error(
          `disconnect is only valid on optional relation ${write.relationName}`,
        );
      }

      if (write.disconnect === true) {
        throw new Error(
          `disconnect for hasMany relation ${write.relationName} must be an array of unique where objects`,
        );
      }

      const rows = await load(write.disconnect);
      const ids = [...new Set(rows.map((row) => val(child, column, row)))];

      if (!ids.length) continue;

      await patch(ctx, child, link.fk, ids, null, ctx.parentKey);
      ranMany = true;
    }
  }

  return { patches, ranMany };
};
