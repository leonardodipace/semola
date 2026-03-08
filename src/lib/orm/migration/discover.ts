import { pathToFileURL } from "node:url";
import { err, mightThrow, ok } from "../../errors/index.js";
import type { ColumnDef } from "../column.js";
import type { ColumnKind, ColumnMetaBase } from "../types.js";
import type { SchemaSnapshot } from "./types.js";

type LoadedOrm = {
  options: { url: string };
  dialect: "postgres" | "mysql" | "sqlite";
  tables: Record<
    string,
    {
      tableName: string;
      columns: Record<string, ColumnDef<ColumnKind, ColumnMetaBase, unknown>>;
    }
  >;
};

function isDialect(value: unknown) {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

function buildUrlFromSqlOptions(sql: unknown) {
  if (typeof sql !== "object" && typeof sql !== "function") {
    return null;
  }

  if (sql === null) {
    return null;
  }

  const options = Reflect.get(sql, "options");

  if (typeof options !== "object" || options === null) {
    return null;
  }

  const adapter = Reflect.get(options, "adapter");

  if (adapter === "sqlite") {
    const filename = Reflect.get(options, "filename");

    if (typeof filename !== "string") {
      return null;
    }

    return `sqlite:${filename}`;
  }

  if (adapter !== "postgres" && adapter !== "mysql") {
    return null;
  }

  const hostname = Reflect.get(options, "hostname");
  const database = Reflect.get(options, "database");

  if (typeof hostname !== "string") {
    return null;
  }

  if (typeof database !== "string") {
    return null;
  }

  let username: string | null = null;

  const rawUsername = Reflect.get(options, "username");

  if (typeof rawUsername === "string" && rawUsername.length > 0) {
    username = rawUsername;
  }

  let password: string | null = null;

  const rawPassword = Reflect.get(options, "password");

  if (typeof rawPassword === "string" && rawPassword.length > 0) {
    password = rawPassword;
  }

  let port: number | null = null;

  const rawPort = Reflect.get(options, "port");

  if (typeof rawPort === "number") {
    port = rawPort;
  }

  let auth = "";

  if (username && password) {
    auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (username) {
    auth = `${encodeURIComponent(username)}@`;
  }

  const portPart = port ? `:${port}` : "";

  return `${adapter}://${auth}${hostname}${portPart}/${database}`;
}

function isTableLike(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (typeof Reflect.get(value, "tableName") !== "string") {
    return false;
  }

  const columns = Reflect.get(value, "columns");

  if (typeof columns !== "object" || columns === null) {
    return false;
  }

  return true;
}

function isModelLike(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!isDialect(Reflect.get(value, "dialect"))) {
    return false;
  }

  if (!isTableLike(Reflect.get(value, "table"))) {
    return false;
  }

  return true;
}

function fromCreateOrmClient(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const metadata = Reflect.get(value, "__semolaOrm");

  if (typeof metadata === "object" && metadata !== null) {
    const maybeOptions = Reflect.get(metadata, "options");

    if (typeof maybeOptions !== "object" || maybeOptions === null) {
      return null;
    }

    const url = Reflect.get(maybeOptions, "url");

    if (typeof url !== "string") {
      return null;
    }

    const maybeDialect = Reflect.get(metadata, "dialect");

    if (!isDialect(maybeDialect)) {
      return null;
    }

    const maybeTables = Reflect.get(metadata, "tables");

    if (typeof maybeTables !== "object" || maybeTables === null) {
      return null;
    }

    for (const table of Object.values(maybeTables as Record<string, unknown>)) {
      if (!isTableLike(table)) {
        return null;
      }
    }

    const result: LoadedOrm = {
      options: { url },
      dialect: maybeDialect,
      tables: maybeTables as LoadedOrm["tables"],
    };

    return result;
  }

  const tables: LoadedOrm["tables"] = {};
  let dialect: LoadedOrm["dialect"] | null = null;
  let url: string | null = null;

  for (const [key, candidate] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!isModelLike(candidate)) {
      continue;
    }

    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }

    const modelDialect = Reflect.get(candidate, "dialect");
    const modelTable = Reflect.get(candidate, "table");
    const modelSql = Reflect.get(candidate, "sql");

    if (
      modelDialect !== "postgres" &&
      modelDialect !== "mysql" &&
      modelDialect !== "sqlite"
    ) {
      continue;
    }

    if (dialect && dialect !== modelDialect) {
      return null;
    }

    dialect = modelDialect;
    tables[key] = modelTable as LoadedOrm["tables"][string];

    if (!url) {
      url = buildUrlFromSqlOptions(modelSql);
    }
  }

  if (!dialect) {
    return null;
  }

  if (Object.keys(tables).length === 0) {
    return null;
  }

  if (!url) {
    return null;
  }

  return { options: { url }, dialect, tables };
}

function isOrmLike(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const options = Reflect.get(value, "options");

  if (typeof options !== "object" || options === null) {
    return false;
  }

  if (typeof Reflect.get(options, "url") !== "string") {
    return false;
  }

  if (!isDialect(Reflect.get(value, "dialect"))) {
    return false;
  }

  const tables = Reflect.get(value, "tables");

  if (typeof tables !== "object" || tables === null) {
    return false;
  }

  return true;
}

export async function loadOrmFromSchema(schemaPath: string) {
  const schemaUrl = pathToFileURL(schemaPath).href;

  const [importErr, mod] = await mightThrow(
    import(`${schemaUrl}?t=${Date.now()}`),
  );

  if (importErr) {
    return err("SchemaError", `Could not load schema module: ${schemaPath}`);
  }

  const candidates = [
    (mod as Record<string, unknown>).default,
    ...Object.values(mod as Record<string, unknown>),
  ];

  for (const candidate of candidates) {
    if (isOrmLike(candidate)) {
      return ok(candidate as LoadedOrm);
    }

    const fromClient = fromCreateOrmClient(candidate);

    if (fromClient) {
      return ok(fromClient);
    }
  }

  return err(
    "SchemaError",
    `Could not find an Orm instance in schema module: ${schemaPath}`,
  );
}

export function buildSchemaSnapshot(orm: {
  dialect: "postgres" | "mysql" | "sqlite";
  tables: Record<
    string,
    {
      tableName: string;
      columns: Record<string, ColumnDef<ColumnKind, ColumnMetaBase, unknown>>;
    }
  >;
}) {
  const owners = new Map<
    ColumnDef<ColumnKind, ColumnMetaBase, unknown>,
    { tableName: string; sqlName: string }
  >();

  for (const table of Object.values(orm.tables)) {
    for (const column of Object.values(table.columns)) {
      owners.set(column, {
        tableName: table.tableName,
        sqlName: column.meta.sqlName,
      });
    }
  }

  const tables = Object.fromEntries(
    Object.entries(orm.tables).map(([tableKey, table]) => {
      const columns = Object.fromEntries(
        Object.entries(table.columns).map(([columnKey, column]) => {
          let referencesTable: string | null = null;
          let referencesColumn: string | null = null;

          if (column.meta.references) {
            const targetColumn = column.meta.references();
            const owner = owners.get(targetColumn);

            if (owner) {
              referencesTable = owner.tableName;
              referencesColumn = owner.sqlName;
            }
          }

          return [
            columnKey,
            {
              key: columnKey,
              sqlName: column.meta.sqlName,
              kind: column.kind,
              isPrimaryKey: column.meta.isPrimaryKey,
              isNotNull: column.meta.isNotNull,
              isUnique: column.meta.isUnique,
              hasDefault: column.meta.hasDefault,
              defaultKind: column.meta.defaultKind,
              defaultValue: column.meta.defaultValue,
              referencesTable,
              referencesColumn,
              onDeleteAction: column.meta.onDeleteAction,
            },
          ];
        }),
      );

      return [
        tableKey,
        {
          key: tableKey,
          tableName: table.tableName,
          columns,
        },
      ];
    }),
  );

  const snapshot: SchemaSnapshot = {
    dialect: orm.dialect,
    tables,
  };

  return snapshot;
}
