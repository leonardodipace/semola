import type { Adapter } from "./dialect/types.js";

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
  adapter: Adapter;
  url: string;
  createSql: () => Bun.SQL;
  beforeEach?: () => Promise<void>;
};

export const integrationAdapters = (): IntegrationAdapter[] => {
  const adapters: IntegrationAdapter[] = [
    {
      adapter: "sqlite",
      url: ":memory:",
      createSql: () => new Bun.SQL(":memory:"),
    },
  ];

  if (!SEMOLA_POSTGRES_URL) return adapters;

  adapters.push({
    adapter: "postgres",
    url: SEMOLA_POSTGRES_URL,
    createSql: () => new Bun.SQL(SEMOLA_POSTGRES_URL, { adapter: "postgres" }),
    beforeEach: () => resetPostgres(SEMOLA_POSTGRES_URL),
  });

  return adapters;
};
