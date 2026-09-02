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
import type { DialectSpec } from "./types.js";

export type ParsedRelationWrite = {
  relationName: string;
  connect?: Record<string, unknown> | Array<Record<string, unknown>>;
  disconnect?: true | Array<Record<string, unknown>>;
};

export type SplitMutationDataResult = {
  columnData: Record<string, unknown>;
  relationWrites: ParsedRelationWrite[];
};

const isPlainObject = (value: unknown) => {
  if (typeof value !== "object") return false;
  if (value === null) return false;
  if (Array.isArray(value)) return false;

  return true;
};

export const isRelationWrite = (value: unknown) => {
  if (!isPlainObject(value)) return false;

  const record = value as Record<string, unknown>;

  if ("connect" in record) return true;
  if ("disconnect" in record) return true;

  return false;
};

const RELATION_WRITE_KEYS = new Set(["connect", "disconnect"]);

const assertKnownRelationWriteKeys = (
  relationName: string,
  record: Record<string, unknown>,
) => {
  const unknownKeys = Object.keys(record).filter(
    (key) => !RELATION_WRITE_KEYS.has(key),
  );

  if (!unknownKeys.length) return;

  throw new Error(
    `Relation write for ${relationName} has unknown operators: ${unknownKeys.join(", ")}`,
  );
};

export const parseRelationWrite = (
  relationName: string,
  value: unknown,
): ParsedRelationWrite => {
  if (!isPlainObject(value)) {
    throw new Error(
      `Invalid relation write for ${relationName}: expected an object with connect or disconnect`,
    );
  }

  const record = value as Record<string, unknown>;
  assertKnownRelationWriteKeys(relationName, record);
  const connect = record.connect;
  const disconnect = record.disconnect;
  const hasConnect = connect !== undefined;
  const hasDisconnect = disconnect !== undefined;

  if (hasConnect) {
    if (hasDisconnect) {
      throw new Error(
        `Relation write for ${relationName} cannot include both connect and disconnect`,
      );
    }
  }

  if (!hasConnect) {
    if (!hasDisconnect) {
      throw new Error(
        `Relation write for ${relationName} must include connect or disconnect`,
      );
    }
  }

  if (hasConnect) {
    if (connect === null) {
      throw new Error(`connect for ${relationName} cannot be null`);
    }
  }

  if (hasDisconnect) {
    if (disconnect === null) {
      throw new Error(`disconnect for ${relationName} cannot be null`);
    }
  }

  const result: ParsedRelationWrite = { relationName };

  if (hasConnect) {
    if (Array.isArray(connect)) {
      result.connect = connect.map((entry) =>
        normalizeConnectWhere(relationName, entry),
      );
      return result;
    }

    result.connect = normalizeConnectWhere(relationName, connect);
    return result;
  }

  if (disconnect === true) {
    result.disconnect = true;
    return result;
  }

  if (!Array.isArray(disconnect)) {
    throw new Error(
      `disconnect for ${relationName} must be true or an array of unique where objects`,
    );
  }

  result.disconnect = disconnect.map((entry) =>
    normalizeConnectWhere(relationName, entry),
  );

  return result;
};

const normalizeConnectWhere = (relationName: string, value: unknown) => {
  if (!isPlainObject(value)) {
    throw new Error(
      `connect/disconnect entry for ${relationName} must be a unique where object`,
    );
  }

  return value as Record<string, unknown>;
};

export const splitMutationData = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  data: Record<string, unknown>,
): SplitMutationDataResult => {
  const columnData: Record<string, unknown> = {};
  const relationWrites: ParsedRelationWrite[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    if (key in relations) {
      relationWrites.push(parseRelationWrite(key, value));
      continue;
    }

    if (!table.columns[key]) {
      throw new Error(`Unknown data key "${key}" on table ${table.sqlName}`);
    }

    columnData[key] = value;
  }

  return { columnData, relationWrites };
};

const connectWhereEntries = (connect: ParsedRelationWrite["connect"]) => {
  if (!connect) return [];

  if (Array.isArray(connect)) return connect;

  return [connect];
};

const disconnectWhereEntries = (
  disconnect: ParsedRelationWrite["disconnect"],
) => {
  if (!disconnect) return [];
  if (disconnect === true) return [];

  return disconnect;
};

export const resolveConnectRecords = async (
  sql: Bun.SQL,
  spec: DialectSpec,
  table: Table,
  connect: ParsedRelationWrite["connect"],
) => {
  const wheres = connectWhereEntries(connect);
  const rows: Array<Record<string, unknown>> = [];

  for (const where of wheres) {
    validateFindUniqueWhere(table, where);
    const row = await findUniqueRow(sql, spec, table, where);

    if (!row) {
      throw new Error(
        `Record to connect not found on table ${table.sqlName} for ${JSON.stringify(where)}`,
      );
    }

    rows.push(row);
  }

  return rows;
};

const findUniqueRow = async (
  sql: Bun.SQL,
  spec: DialectSpec,
  table: Table,
  where: Record<string, unknown>,
) => {
  const placeholders = new PlaceholderGenerator(spec);
  const nextPlaceholder = placeholders.asFn();
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

    clauses.push(`${quoteIdentifier(column.sqlName)} = ${nextPlaceholder()}`);
    params.push(serializeColumnValue(column, value));
  }

  const statement = `SELECT * FROM ${quoteIdentifier(table.sqlName)} WHERE ${clauses.join(" AND ")} LIMIT 1`;
  const rows = await sql.unsafe(statement, params);

  return rows[0] ?? null;
};

const requireNullableForeignKey = (column: Column, relationName: string) => {
  if (column._meta.isNullable) return;

  throw new Error(
    `disconnect is only valid on optional relation ${relationName}`,
  );
};

const primaryKeyColumn = (table: Table) => {
  for (const column of Object.values(table.columns)) {
    if (column._meta.isPrimaryKey) return column;
  }

  throw new Error(`Table ${table.sqlName} is missing a primary key column`);
};

const primaryKeyValue = (
  table: Table,
  row: Record<string, unknown>,
  where?: Record<string, unknown>,
) => {
  const pkColumn = primaryKeyColumn(table);

  for (const [jsKey, column] of Object.entries(table.columns)) {
    if (column !== pkColumn) continue;

    if (where?.[jsKey] !== undefined) return where[jsKey];

    const value = row[jsKey];

    if (value !== undefined) return value;
  }

  throw new Error(
    `Missing primary key value for table ${table.sqlName} during relation write`,
  );
};

export type PlanHasOneRelationWritesInput = {
  sql: Bun.SQL;
  spec: DialectSpec;
  parentTable: Table;
  relations: TableRelations;
  relationWrites: ParsedRelationWrite[];
};

export type PlanHasManyRelationWritesInput = PlanHasOneRelationWritesInput & {
  parentKey: unknown;
};

export const planHasOneRelationWrites = async (
  input: PlanHasOneRelationWritesInput,
): Promise<Record<string, unknown>> => {
  const columnData: Record<string, unknown> = {};

  for (const write of input.relationWrites) {
    const relation = input.relations[write.relationName];

    if (!relation) {
      throw new Error(
        `Unknown relation ${write.relationName} on table ${input.parentTable.sqlName}`,
      );
    }

    if (relation._type !== "hasOne") continue;

    const { localForeignKey, target } = foreignKeyResolver.resolveHasOne({
      sourceTable: input.parentTable,
      relationTable: relation._table,
      relationForeignKey: relation._foreignKey,
    });

    if (write.connect) {
      const [connected] = await resolveConnectRecords(
        input.sql,
        input.spec,
        relation._table,
        write.connect,
      );

      if (!connected) {
        throw new Error(
          `Record to connect not found for relation ${write.relationName}`,
        );
      }

      const targetJsKey = Object.entries(relation._table.columns).find(
        ([, column]) => column === target,
      )?.[0];

      if (!targetJsKey) {
        throw new Error(
          `Missing referenced column on ${relation._table.sqlName} for relation ${write.relationName}`,
        );
      }

      columnData[relation._foreignKey] = connected[targetJsKey];
    }

    if (write.disconnect) {
      if (write.disconnect !== true) {
        throw new Error(
          `disconnect for hasOne relation ${write.relationName} must be true`,
        );
      }

      requireNullableForeignKey(localForeignKey, write.relationName);
      columnData[relation._foreignKey] = null;
    }
  }

  return columnData;
};

export const planHasManyRelationWrites = async (
  input: PlanHasManyRelationWritesInput,
): Promise<Array<() => Promise<void>>> => {
  const deferredWrites: Array<() => Promise<void>> = [];

  for (const write of input.relationWrites) {
    const relation = input.relations[write.relationName];

    if (!relation) {
      throw new Error(
        `Unknown relation ${write.relationName} on table ${input.parentTable.sqlName}`,
      );
    }

    if (relation._type !== "hasMany") continue;

    const { fk: childForeignKey } = foreignKeyResolver.resolveHasMany(
      input.parentTable,
      relation._table,
    );

    if (write.connect) {
      const connectedRows = await resolveConnectRecords(
        input.sql,
        input.spec,
        relation._table,
        write.connect,
      );
      const childPk = primaryKeyColumn(relation._table);
      const childPkJsKey = Object.entries(relation._table.columns).find(
        ([, column]) => column === childPk,
      )?.[0];

      if (!childPkJsKey) {
        throw new Error(
          `Missing primary key on ${relation._table.sqlName} for relation ${write.relationName}`,
        );
      }

      const childIds = connectedRows.map((row) => row[childPkJsKey]);

      deferredWrites.push(async () => {
        await connectChildRecords({
          sql: input.sql,
          spec: input.spec,
          childTable: relation._table,
          childForeignKey,
          childIds,
          parentKey: input.parentKey,
        });
      });
    }

    if (write.disconnect) {
      requireNullableForeignKey(childForeignKey, write.relationName);

      const wheres = disconnectWhereEntries(write.disconnect);
      const childPk = primaryKeyColumn(relation._table);
      const childPkJsKey = Object.entries(relation._table.columns).find(
        ([, column]) => column === childPk,
      )?.[0];

      if (!childPkJsKey) {
        throw new Error(
          `Missing primary key on ${relation._table.sqlName} for relation ${write.relationName}`,
        );
      }

      if (write.disconnect === true) {
        deferredWrites.push(async () => {
          await clearChildForeignKeys({
            sql: input.sql,
            spec: input.spec,
            childTable: relation._table,
            childForeignKey,
            parentKey: input.parentKey,
          });
        });
        continue;
      }

      const disconnectedRows = await resolveConnectRecords(
        input.sql,
        input.spec,
        relation._table,
        wheres,
      );
      const childIds = disconnectedRows.map((row) => row[childPkJsKey]);

      deferredWrites.push(async () => {
        await disconnectChildRecords({
          sql: input.sql,
          spec: input.spec,
          childTable: relation._table,
          childForeignKey,
          parentKey: input.parentKey,
          childIds,
        });
      });
    }
  }

  return deferredWrites;
};

export const primaryKeyValueFromRow = (
  table: Table,
  row: Record<string, unknown>,
  where?: Record<string, unknown>,
) => primaryKeyValue(table, row, where);

const connectChildRecords = async (input: {
  sql: Bun.SQL;
  spec: DialectSpec;
  childTable: Table;
  childForeignKey: Column;
  parentKey: unknown;
  childIds: unknown[];
}) => {
  if (!input.childIds.length) return;

  const placeholders = new PlaceholderGenerator(input.spec);
  const nextPlaceholder = placeholders.asFn();
  const childPk = primaryKeyColumn(input.childTable);
  const setPlaceholder = nextPlaceholder();
  const params: unknown[] = [
    serializeColumnValue(input.childForeignKey, input.parentKey),
  ];
  const idPlaceholders: string[] = [];

  for (const childId of input.childIds) {
    idPlaceholders.push(nextPlaceholder());
    params.push(serializeColumnValue(childPk, childId));
  }

  const statement = `UPDATE ${quoteIdentifier(input.childTable.sqlName)} SET ${quoteIdentifier(input.childForeignKey.sqlName)} = ${setPlaceholder} WHERE ${quoteIdentifier(childPk.sqlName)} IN (${idPlaceholders.join(", ")}) RETURNING ${quoteIdentifier(childPk.sqlName)}`;
  const updated = await input.sql.unsafe(statement, params);

  if (updated.length !== input.childIds.length) {
    throw new Error(
      `Failed to connect all records on ${input.childTable.sqlName}`,
    );
  }
};

const disconnectChildRecords = async (input: {
  sql: Bun.SQL;
  spec: DialectSpec;
  childTable: Table;
  childForeignKey: Column;
  parentKey: unknown;
  childIds: unknown[];
}) => {
  if (!input.childIds.length) return;

  const placeholders = new PlaceholderGenerator(input.spec);
  const nextPlaceholder = placeholders.asFn();
  const childPk = primaryKeyColumn(input.childTable);
  const params: unknown[] = [];
  const idPlaceholders: string[] = [];

  for (const childId of input.childIds) {
    idPlaceholders.push(nextPlaceholder());
    params.push(serializeColumnValue(childPk, childId));
  }

  params.push(serializeColumnValue(input.childForeignKey, input.parentKey));

  const parentPlaceholder = nextPlaceholder();
  const statement = `UPDATE ${quoteIdentifier(input.childTable.sqlName)} SET ${quoteIdentifier(input.childForeignKey.sqlName)} = NULL WHERE ${quoteIdentifier(childPk.sqlName)} IN (${idPlaceholders.join(", ")}) AND ${quoteIdentifier(input.childForeignKey.sqlName)} = ${parentPlaceholder} RETURNING ${quoteIdentifier(childPk.sqlName)}`;
  const updated = await input.sql.unsafe(statement, params);

  if (updated.length !== input.childIds.length) {
    throw new Error(
      `Failed to disconnect all records on ${input.childTable.sqlName}`,
    );
  }
};

const clearChildForeignKeys = async (input: {
  sql: Bun.SQL;
  spec: DialectSpec;
  childTable: Table;
  childForeignKey: Column;
  parentKey: unknown;
}) => {
  const placeholders = new PlaceholderGenerator(input.spec);
  const nextPlaceholder = placeholders.asFn();
  const params = [serializeColumnValue(input.childForeignKey, input.parentKey)];
  const statement = `UPDATE ${quoteIdentifier(input.childTable.sqlName)} SET ${quoteIdentifier(input.childForeignKey.sqlName)} = NULL WHERE ${quoteIdentifier(input.childForeignKey.sqlName)} = ${nextPlaceholder()}`;

  await input.sql.unsafe(statement, params);
};
