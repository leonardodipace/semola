import type { OnDeleteAction } from "./types.js";

export function toOnDelete(action: string): OnDeleteAction | null {
  if (action === "CASCADE") {
    return "CASCADE";
  }

  if (action === "RESTRICT") {
    return "RESTRICT";
  }

  if (action === "SET NULL") {
    return "SET NULL";
  }

  return null;
}

export function toErrMsg(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
