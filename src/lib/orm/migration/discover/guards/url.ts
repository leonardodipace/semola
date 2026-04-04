export function buildUrlFromSqlOptions(sql: unknown) {
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
