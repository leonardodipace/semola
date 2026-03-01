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

function isRecord(value: unknown) {
  return Boolean(value) && typeof value === "object";
}

function isObjectLike(value: unknown) {
  return (
    Boolean(value) && (typeof value === "object" || typeof value === "function")
  );
}

function isDialect(value: unknown) {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

function buildUrlFromSqlOptions(sql: unknown) {
  if (!isObjectLike(sql)) {
    return null;
  }

  const sqlObject = sql as object;

  const options = Reflect.get(sqlObject, "options");

  if (!isRecord(options)) {
    return null;
  }

  const optionsRecord = options as Record<string, unknown>;

  const adapter = optionsRecord.adapter;

  if (adapter === "sqlite") {
    const filename = optionsRecord.filename;

    if (typeof filename !== "string") {
      return null;
    }

    return `sqlite:${filename}`;
  }

  if (adapter !== "postgres" && adapter !== "mysql") {
    return null;
  }

  const hostname = optionsRecord.hostname;
  const database = optionsRecord.database;

  if (typeof hostname !== "string") {
    return null;
  }

  if (typeof database !== "string") {
    return null;
  }

  const username =
    typeof optionsRecord.username === "string" &&
    optionsRecord.username.length > 0
      ? optionsRecord.username
      : null;
  const password =
    typeof optionsRecord.password === "string" &&
    optionsRecord.password.length > 0
      ? optionsRecord.password
      : null;
  const port =
    typeof optionsRecord.port === "number" ? optionsRecord.port : null;

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
  if (!isRecord(value)) {
    return false;
  }
  const table = value as Record<string, unknown>;

  if (typeof table.tableName !== "string") {
    return false;
  }

  if (!isRecord(table.columns)) {
    return false;
  }

  return true;
}

function isModelLike(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const model = value as Record<string, unknown>;

  if (!isDialect(model.dialect)) {
    return false;
  }

  if (!isTableLike(model.table)) {
    return false;
  }

  return true;
}

function fromCreateOrmClient(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const client = value as Record<string, unknown>;

  const metadata = Reflect.get(client as object, "__semolaOrm");

  if (isRecord(metadata)) {
    const maybeOptions = metadata.options;
    const maybeDialect = metadata.dialect;
    const maybeTables = metadata.tables;

    if (isRecord(maybeOptions)) {
      if (typeof maybeOptions.url === "string") {
        if (isDialect(maybeDialect)) {
          if (isRecord(maybeTables)) {
            let allTablesValid = true;

            for (const table of Object.values(maybeTables)) {
              if (!isTableLike(table)) {
                allTablesValid = false;
                break;
              }
            }

            if (allTablesValid) {
              return {
                options: { url: maybeOptions.url },
                dialect: maybeDialect,
                tables: maybeTables as LoadedOrm["tables"],
              } as LoadedOrm;
            }
          }
        }
      }
    }
  }

  const tables: LoadedOrm["tables"] = {};
  let dialect: LoadedOrm["dialect"] | null = null;
  let url: string | null = null;

  for (const [key, candidate] of Object.entries(client)) {
    if (!isModelLike(candidate)) {
      continue;
    }

    const model = candidate as {
      table: {
        tableName: string;
        columns: Record<string, ColumnDef<ColumnKind, ColumnMetaBase, unknown>>;
      };
      dialect: LoadedOrm["dialect"];
      sql: unknown;
    };

    if (dialect && dialect !== model.dialect) {
      return null;
    }

    dialect = model.dialect;
    tables[key] = model.table;

    if (!url) {
      url = buildUrlFromSqlOptions(model.sql);
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

  const orm: LoadedOrm = {
    options: { url },
    dialect,
    tables,
  };

  return orm;
}

function isOrmLike(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const orm = value as Record<string, unknown>;

  if (!isRecord(orm.options)) {
    return false;
  }
  const options = orm.options as Record<string, unknown>;

  if (typeof options.url !== "string") {
    return false;
  }

  if (!isDialect(orm.dialect)) {
    return false;
  }

  if (!isRecord(orm.tables)) {
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
