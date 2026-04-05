import type { SQL } from "bun";
import { mightThrow } from "../../../errors/index.js";

export async function getEnumRows(sql: SQL, schema: string) {
  return mightThrow(
    sql`
      SELECT
        t.typname,
        e.enumlabel
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_enum e
        ON e.enumtypid = t.oid
      JOIN pg_catalog.pg_namespace n
        ON n.oid = t.typnamespace
      WHERE n.nspname = ${schema}
      ORDER BY t.typname, e.enumsortorder
    `.values() as Promise<[string, string][]>,
  );
}

export async function getTableRows(sql: SQL, schema: string) {
  return mightThrow(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schema}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `.values() as Promise<[string][]>,
  );
}

export async function getColumnRows(
  sql: SQL,
  schema: string,
  tableName: string,
) {
  return mightThrow(
    sql`
      SELECT
        column_name,
        udt_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name = ${tableName}
      ORDER BY ordinal_position
    `.values() as Promise<[string, string, string, string, string | null][]>,
  );
}

export async function getConstraintRows(
  sql: SQL,
  schema: string,
  tableName: string,
) {
  return mightThrow(
    sql`
      SELECT
        kcu.column_name,
        tc.constraint_type,
        COUNT(*) OVER (PARTITION BY tc.constraint_name) AS constrained_columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = ${schema}
        AND tc.table_name = ${tableName}
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      UNION ALL
      SELECT
        a.attname AS column_name,
        'UNIQUE' AS constraint_type,
        1 AS constrained_columns
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class t
        ON t.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n
        ON n.oid = t.relnamespace
      JOIN LATERAL unnest(i.indkey::smallint[]) AS key(attnum)
        ON TRUE
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = t.oid
        AND a.attnum = key.attnum
      WHERE n.nspname = ${schema}
        AND t.relname = ${tableName}
        AND i.indisunique = TRUE
        AND i.indisprimary = FALSE
        AND i.indexprs IS NULL
        AND i.indpred IS NULL
        AND i.indnkeyatts = 1
      `.values() as Promise<[string, string, number?][]>,
  );
}

export async function getForeignKeyRows(
  sql: SQL,
  schema: string,
  tableName: string,
) {
  return mightThrow(
    sql`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE tc.table_schema = ${schema}
        AND tc.table_name = ${tableName}
        AND tc.constraint_type = 'FOREIGN KEY'
    `.values() as Promise<[string, string, string, string][]>,
  );
}
