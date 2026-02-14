import type { SQL } from "bun";
import {
  Column,
  type ManyRelation,
  type OneRelation,
  type Table,
} from "./index.js";

export type Dialect = "postgres" | "mysql" | "sqlite";

export type ColumnMeta = {
  fieldName: string;
  sqlName: string;
  kind?: string;
};

export type RelationMeta = {
  fieldName: string;
  type: "one" | "many";
  foreignKey: string;
  targetTable: Table<string, Record<string, unknown>>;
  nullable: boolean;
};

export type TableMeta = {
  sqlName: string;
  columns: ColumnMeta[];
  relations: RelationMeta[];
  primaryKey: ColumnMeta | undefined;
};

export const detectDialect = (url: string): Dialect => {
  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) return "mysql";
  if (
    url.startsWith("sqlite://") ||
    url.startsWith("file://") ||
    url.startsWith("file:") ||
    url === ":memory:"
  )
    return "sqlite";
  return "postgres";
};

export const resolveTableMeta = (
  table: Table<string, Record<string, unknown>>,
  rels: Record<string, unknown>,
): TableMeta => {
  const columns: ColumnMeta[] = [];
  const relations: RelationMeta[] = [];
  let primaryKey: ColumnMeta | undefined;

  for (const [fieldName, col] of Object.entries(table.columns)) {
    if (col instanceof Column) {
      const meta: ColumnMeta = {
        fieldName,
        sqlName: col.sqlName,
        kind: (col as unknown as { kind?: string }).kind,
      };
      columns.push(meta);
      if (col.isPrimaryKey) {
        primaryKey = meta;
      }
    }
  }

  for (const [fieldName, rel] of Object.entries(rels)) {
    if (isOneRelation(rel)) {
      relations.push({
        fieldName,
        type: "one",
        foreignKey: rel.foreignKey,
        targetTable: rel.ref() as Table<string, Record<string, unknown>>,
        nullable: rel.isNullable,
      });
    } else if (isManyRelation(rel)) {
      relations.push({
        fieldName,
        type: "many",
        foreignKey: "",
        targetTable: rel.ref() as Table<string, Record<string, unknown>>,
        nullable: false,
      });
    }
  }

  return { sqlName: table.sqlName, columns, relations, primaryKey };
};

const isOneRelation = (
  v: unknown,
): v is OneRelation<string, unknown, boolean> => {
  return (
    v !== null &&
    typeof v === "object" &&
    "_type" in v &&
    (v as Record<string, unknown>)._type === "one"
  );
};

const isManyRelation = (v: unknown): v is ManyRelation<unknown> => {
  return (
    v !== null &&
    typeof v === "object" &&
    "_type" in v &&
    (v as Record<string, unknown>)._type === "many"
  );
};

type SqlFragment = SQL.Query<unknown>;

const buildWhereClause = (
  db: InstanceType<typeof SQL>,
  meta: TableMeta,
  where: Record<string, unknown>,
  allTableMetas: Map<string, TableMeta>,
): SqlFragment => {
  const conditions: SqlFragment[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    const colMeta = meta.columns.find((c) => c.fieldName === key);
    if (colMeta) {
      if (value === null) {
        conditions.push(db`${db(colMeta.sqlName)} IS NULL`);
      } else {
        conditions.push(db`${db(colMeta.sqlName)} = ${value}`);
      }
      continue;
    }

    const relMeta = meta.relations.find((r) => r.fieldName === key);
    if (!relMeta) continue;

    const targetMeta = allTableMetas.get(relMeta.targetTable.sqlName);
    if (!targetMeta) continue;

    if (relMeta.type === "one" && typeof value === "object" && value !== null) {
      const nestedWhere = value as Record<string, unknown>;
      const fkCol = meta.columns.find((c) => c.sqlName === relMeta.foreignKey);
      if (!fkCol || !targetMeta.primaryKey) continue;

      const subWhere = buildWhereClause(
        db,
        targetMeta,
        nestedWhere,
        allTableMetas,
      );
      conditions.push(
        db`${db(fkCol.sqlName)} IN (SELECT ${db(targetMeta.primaryKey.sqlName)} FROM ${db(targetMeta.sqlName)} WHERE ${subWhere})`,
      );
    }

    if (
      relMeta.type === "many" &&
      typeof value === "object" &&
      value !== null
    ) {
      const manyFilter = value as {
        some?: Record<string, unknown>;
        none?: Record<string, unknown>;
      };
      if (!meta.primaryKey) continue;

      const targetFkCol = findForeignKeyToParent(targetMeta, meta);
      if (!targetFkCol) continue;

      if (manyFilter.some) {
        const subWhere = buildWhereClause(
          db,
          targetMeta,
          manyFilter.some,
          allTableMetas,
        );
        conditions.push(
          db`EXISTS (SELECT 1 FROM ${db(targetMeta.sqlName)} WHERE ${db(targetFkCol)} = ${db(meta.sqlName)}.${db(meta.primaryKey.sqlName)} AND ${subWhere})`,
        );
      }

      if (manyFilter.none) {
        const subWhere = buildWhereClause(
          db,
          targetMeta,
          manyFilter.none,
          allTableMetas,
        );
        conditions.push(
          db`NOT EXISTS (SELECT 1 FROM ${db(targetMeta.sqlName)} WHERE ${db(targetFkCol)} = ${db(meta.sqlName)}.${db(meta.primaryKey.sqlName)} AND ${subWhere})`,
        );
      }
    }
  }

  if (conditions.length === 0) return db`1 = 1`;

  let result = conditions[0] as SqlFragment;
  for (let i = 1; i < conditions.length; i++) {
    result = db`${result} AND ${conditions[i]}`;
  }
  return result;
};

const findForeignKeyToParent = (
  targetMeta: TableMeta,
  parentMeta: TableMeta,
): string | undefined => {
  for (const rel of targetMeta.relations) {
    if (rel.type === "one" && rel.targetTable.sqlName === parentMeta.sqlName) {
      return rel.foreignKey;
    }
  }
  return undefined;
};

export const mapRow = (
  row: Record<string, unknown>,
  meta: TableMeta,
): Record<string, unknown> => {
  const mapped: Record<string, unknown> = {};
  for (const col of meta.columns) {
    if (col.sqlName in row) {
      const val = row[col.sqlName];
      if (col.kind === "boolean") {
        if (val === 0 || val === 1) mapped[col.fieldName] = Boolean(val);
        else if (val === "0" || val === "1")
          mapped[col.fieldName] = Boolean(Number(val));
        else if (val === "true" || val === "false")
          mapped[col.fieldName] = val === "true";
        else mapped[col.fieldName] = Boolean(val);
      } else {
        mapped[col.fieldName] = val;
      }
    }
  }
  return mapped;
};

export const buildSelect = (
  db: InstanceType<typeof SQL>,
  meta: TableMeta,
  allTableMetas: Map<string, TableMeta>,
  where?: Record<string, unknown>,
  take?: number,
  skip?: number,
) => {
  const whereClause = where
    ? buildWhereClause(db, meta, where, allTableMetas)
    : db`1 = 1`;

  if (take !== undefined && skip !== undefined) {
    return db`SELECT * FROM ${db(meta.sqlName)} WHERE ${whereClause} LIMIT ${take} OFFSET ${skip}`;
  }
  if (take !== undefined) {
    return db`SELECT * FROM ${db(meta.sqlName)} WHERE ${whereClause} LIMIT ${take}`;
  }
  if (skip !== undefined) {
    return db`SELECT * FROM ${db(meta.sqlName)} WHERE ${whereClause} OFFSET ${skip}`;
  }
  return db`SELECT * FROM ${db(meta.sqlName)} WHERE ${whereClause}`;
};

export const buildInsert = async (
  db: InstanceType<typeof SQL>,
  meta: TableMeta,
  data: Record<string, unknown>,
  dialect: Dialect,
) => {
  const sqlData: Record<string, unknown> = {};
  for (const col of meta.columns) {
    if (col.fieldName in data) {
      sqlData[col.sqlName] = data[col.fieldName];
    }
  }

  if (dialect === "mysql") {
    await db`INSERT INTO ${db(meta.sqlName)} ${db(sqlData)}`;
    const [row] =
      await db`SELECT * FROM ${db(meta.sqlName)} WHERE id = LAST_INSERT_ID()`;
    return row;
  }

  const [row] =
    await db`INSERT INTO ${db(meta.sqlName)} ${db(sqlData)} RETURNING *`;
  return row;
};

export const buildUpdate = async (
  db: InstanceType<typeof SQL>,
  meta: TableMeta,
  data: Record<string, unknown>,
  allTableMetas: Map<string, TableMeta>,
  where: Record<string, unknown>,
  dialect: Dialect,
) => {
  const sqlData: Record<string, unknown> = {};
  for (const col of meta.columns) {
    if (col.fieldName in data) {
      sqlData[col.sqlName] = data[col.fieldName];
    }
  }

  const whereClause = buildWhereClause(db, meta, where, allTableMetas);

  if (dialect === "mysql") {
    const rows =
      await db`SELECT * FROM ${db(meta.sqlName)} WHERE ${whereClause}`;
    await db`UPDATE ${db(meta.sqlName)} SET ${db(sqlData)} WHERE ${whereClause}`;
    return rows[0];
  }

  const [row] =
    await db`UPDATE ${db(meta.sqlName)} SET ${db(sqlData)} WHERE ${whereClause} RETURNING *`;
  return row;
};

export const buildDelete = async (
  db: InstanceType<typeof SQL>,
  meta: TableMeta,
  allTableMetas: Map<string, TableMeta>,
  where: Record<string, unknown>,
  dialect: Dialect,
) => {
  const whereClause = buildWhereClause(db, meta, where, allTableMetas);

  if (dialect === "mysql") {
    const rows =
      await db`SELECT * FROM ${db(meta.sqlName)} WHERE ${whereClause}`;
    await db`DELETE FROM ${db(meta.sqlName)} WHERE ${whereClause}`;
    return rows[0];
  }

  const [row] =
    await db`DELETE FROM ${db(meta.sqlName)} WHERE ${whereClause} RETURNING *`;
  return row;
};

export const loadRelations = async (
  db: InstanceType<typeof SQL>,
  rows: Record<string, unknown>[],
  include: Record<string, true>,
  meta: TableMeta,
  allTableMetas: Map<string, TableMeta>,
) => {
  if (!meta.primaryKey || rows.length === 0) return rows;
  const parentPk = meta.primaryKey;

  for (const [relField, shouldInclude] of Object.entries(include)) {
    if (!shouldInclude) continue;

    const relMeta = meta.relations.find((r) => r.fieldName === relField);
    if (!relMeta) continue;

    const targetMeta = allTableMetas.get(relMeta.targetTable.sqlName);
    if (!targetMeta) continue;

    if (relMeta.type === "one") {
      // Find the field name that corresponds to this foreign key SQL column
      const fkColMeta = meta.columns.find(
        (c) => c.sqlName === relMeta.foreignKey,
      );
      if (!fkColMeta) continue;
      const fkFieldName = fkColMeta.fieldName;

      const fkValues = rows.map((r) => r[fkFieldName]).filter((v) => v != null);

      if (fkValues.length === 0) continue;

      const targetPk = targetMeta.primaryKey;
      if (!targetPk) continue;

      const related =
        await db`SELECT * FROM ${db(targetMeta.sqlName)} WHERE ${db(targetPk.sqlName)} IN ${db(fkValues)}`;

      const relatedMap = new Map<unknown, Record<string, unknown>>();
      for (const r of related) {
        const mappedRow = mapRow(r as Record<string, unknown>, targetMeta);
        relatedMap.set(mappedRow[targetPk.fieldName], mappedRow);
      }

      for (const row of rows) {
        const fkVal = row[fkFieldName];
        row[relField] = fkVal != null ? (relatedMap.get(fkVal) ?? null) : null;
      }
    }

    if (relMeta.type === "many") {
      const parentPkField = parentPk.fieldName;
      const parentPkValues = rows
        .map((r) => r[parentPkField])
        .filter((v) => v != null);
      if (parentPkValues.length === 0) continue;

      const targetFkCol = findForeignKeyToParent(targetMeta, meta);
      if (!targetFkCol) continue;

      const related =
        await db`SELECT * FROM ${db(targetMeta.sqlName)} WHERE ${db(targetFkCol)} IN ${db(parentPkValues)}`;

      const targetFkField = targetMeta.columns.find(
        (c) => c.sqlName === targetFkCol,
      )?.fieldName;
      if (!targetFkField) continue;

      const relatedMap = new Map<unknown, Record<string, unknown>[]>();
      for (const r of related) {
        const mappedRow = mapRow(r as Record<string, unknown>, targetMeta);
        const fkVal = mappedRow[targetFkField];
        const existing = relatedMap.get(fkVal) ?? [];
        existing.push(mappedRow);
        relatedMap.set(fkVal, existing);
      }

      for (const row of rows) {
        const pkVal = row[parentPkField];
        row[relField] = relatedMap.get(pkVal) ?? [];
      }
    }
  }

  return rows;
};
