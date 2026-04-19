import { pathToFileURL } from "node:url";
import { findLoadedOrm } from "./discover/guards.js";

export { buildSchemaSnapshot } from "./discover/snapshot.js";

export async function loadOrmFromSchema(schemaPath: string) {
  const schemaUrl = pathToFileURL(schemaPath).href;

  const mod = await import(`${schemaUrl}?t=${Date.now()}`);

  const candidates = [
    (mod as Record<string, unknown>).default,
    ...Object.values(mod as Record<string, unknown>),
  ];

  const orm = findLoadedOrm(candidates);

  if (orm) {
    return orm;
  }

  throw new Error(
    `Could not find an Orm instance in schema module: ${schemaPath}`,
  );
}
