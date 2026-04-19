import { fromCreateOrmClient } from "./client.js";
import { isOrmLike } from "./predicates.js";
import type { LoadedOrm } from "./types.js";

export function findLoadedOrm(candidates: unknown[]) {
  for (const candidate of candidates) {
    if (isOrmLike(candidate)) {
      return candidate as LoadedOrm;
    }

    const fromClient = fromCreateOrmClient(candidate);

    if (fromClient) {
      return fromClient;
    }
  }

  return null;
}
