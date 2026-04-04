export function toErrMsg(e: unknown) {
  if (e instanceof Error) {
    return e.message;
  }

  return String(e);
}
