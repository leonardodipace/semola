import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import type { Adapter } from "./dialect/types.js";
import { fromNodeSqlite } from "./node-sqlite.js";
import type { SqlClient } from "./types.js";

export const SEMOLA_POSTGRES_URL = process.env.SEMOLA_POSTGRES_URL;

export const PG_ID = "11111111-1111-1111-1111-111111111111";
export const PG_ID_2 = "22222222-2222-2222-2222-222222222222";
export const PG_ID_3 = "33333333-3333-3333-3333-333333333333";

export const resetPostgres = async (url: string) => {
  const sql = new Bun.SQL(url, { adapter: "postgres" });

  await sql.unsafe("DROP SCHEMA public CASCADE");
  await sql.unsafe("CREATE SCHEMA public");
  await sql.close();
};

export type IntegrationAdapter = {
  name: string;
  adapter: Adapter;
  createSql: () => SqlClient;
  beforeEach?: () => Promise<void>;
};

export const integrationAdapters = (): IntegrationAdapter[] => {
  const adapters: IntegrationAdapter[] = [
    {
      name: "sqlite",
      adapter: "sqlite",
      createSql: () => new Bun.SQL(":memory:"),
    },
    {
      name: "sqlite via node:sqlite",
      adapter: "sqlite",
      createSql: () => fromNodeSqlite(new DatabaseSync(":memory:")),
    },
  ];

  if (!SEMOLA_POSTGRES_URL) return adapters;

  const url = SEMOLA_POSTGRES_URL;

  adapters.push(
    {
      name: "postgres",
      adapter: "postgres",
      createSql: () => new Bun.SQL(url, { adapter: "postgres" }),
      beforeEach: () => resetPostgres(url),
    },
    {
      name: "postgres via postgres.js",
      adapter: "postgres",
      createSql: () =>
        postgres(url, {
          max: 5,
          transform: { undefined: null },
          onnotice: () => {},
        }),
      beforeEach: () => resetPostgres(url),
    },
  );

  return adapters;
};
