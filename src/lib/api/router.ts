export const convertPathToBunFormat = (path: string) => {
  return path.replace(/\{(\w+)\}/g, ":$1");
};

export const parseQueryString = (url: URL) => {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key];

    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (existing) {
      query[key] = [existing, value];
    } else {
      query[key] = value;
    }
  }

  return query;
};

export const parseCookies = (cookieHeader: string | null) => {
  if (!cookieHeader) {
    return {};
  }

  const cookies: Record<string, string> = {};

  for (const pair of cookieHeader.split(";")) {
    const equalsIndex = pair.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = pair.slice(0, equalsIndex).trim();
    const value = pair.slice(equalsIndex + 1).trim();

    if (key && value) {
      cookies[key] = value;
    }
  }

  return cookies;
};
