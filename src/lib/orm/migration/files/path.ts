import { basename, relative, sep } from "node:path";

export function relativeFromCwd(cwd: string, absolutePath: string) {
  const rel = relative(cwd, absolutePath);

  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    return absolutePath;
  }

  if (!rel) {
    return basename(absolutePath);
  }

  return rel;
}
