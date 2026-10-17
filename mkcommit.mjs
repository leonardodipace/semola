import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const run = (args, opts = {}) => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...opts,
  });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
};

run(["add", "-A"]);

const status = run(["status", "--porcelain"]);

if (!status) {
  console.log("nothing to commit");
  process.exit(0);
}

run(["write-tree"]);

const tree = run(["write-tree"]);
const parent = run(["rev-parse", "HEAD"]);
const authorName = run(["log", "-1", "--format=%an"]);
const authorEmail = run(["log", "-1", "--format=%ae"]);

writeFileSync(
  "msg.txt",
  "fix(schema): address review findings for JSON Schema and regex\n",
);

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: authorName,
  GIT_AUTHOR_EMAIL: authorEmail,
  GIT_COMMITTER_NAME: authorName,
  GIT_COMMITTER_EMAIL: authorEmail,
};

// Stage is already done; need index tree reflecting staged files
const indexTree = run(["write-tree"]);

const oid = spawnSync(
  "git",
  ["commit-tree", indexTree, "-p", parent, "-F", "msg.txt"],
  { encoding: "utf8", env },
);

if (oid.status !== 0) {
  console.error(oid.stderr || oid.stdout);
  process.exit(oid.status ?? 1);
}

const commit = oid.stdout.trim();
run(["update-ref", "HEAD", commit]);
unlinkSync("msg.txt");
console.log(run(["cat-file", "-p", "HEAD"]));
