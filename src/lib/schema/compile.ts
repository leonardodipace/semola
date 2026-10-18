import type { Issue } from "./types.js";

export type RunFn<Output> = (
  value: unknown,
  path: PropertyKey[],
  issues: Issue[],
) => Output;

export type StringRule =
  | { kind: "min"; length: number; message: string }
  | { kind: "max"; length: number; message: string }
  | { kind: "length"; length: number; message: string }
  | { kind: "regex"; pattern: RegExp; message: string }
  | { kind: "email"; message: string }
  | { kind: "url"; message: string }
  | { kind: "uuid"; message: string }
  | { kind: "startsWith"; prefix: string; message: string }
  | { kind: "endsWith"; suffix: string; message: string }
  | { kind: "includes"; search: string; message: string };

/** RFC 4122 / 9562 UUID (version 1-8, variant 10xx). Case-folded for JSON Schema. */
export const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const IDENT_KEY_PATTERN = /^[A-Za-z_$][\w$]*$/;

/** Space and ASCII control characters (rejected in emails). */
const ASCII_SPACE_CODE = 32;

const isUuid = (value: string) => {
  return UUID_PATTERN.test(value);
};

const isUrlString = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export type NumberRule =
  | { kind: "min"; value: number; message: string }
  | { kind: "max"; value: number; message: string }
  | { kind: "positive"; message: string }
  | { kind: "nonnegative"; message: string };

export type ArrayBound =
  | { kind: "min"; length: number; message: string }
  | { kind: "max"; length: number; message: string };

export type ObjectField = {
  key: string;
  run: RunFn<unknown>;
  optional: boolean;
  toInline: (
    expr: string,
    pathPrefix: PropertyKey[],
    binds: unknown[],
    dynamicIndex?: string,
  ) => string | null;
};

const isEmail = (value: string) => {
  const at = value.indexOf("@");

  if (at <= 0) {
    return false;
  }

  if (value.includes("@", at + 1)) {
    return false;
  }

  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");

  if (dot <= 0) {
    return false;
  }

  if (dot === domain.length - 1) {
    return false;
  }

  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= ASCII_SPACE_CODE) {
      return false;
    }
  }

  return true;
};

export const pushIssue = (
  issues: Issue[],
  message: string,
  path: PropertyKey[],
) => {
  if (path.length === 0) {
    issues.push({ message });
    return;
  }

  issues.push({ message, path: path.slice() });
};

export const applyStringRules = (
  value: string,
  path: PropertyKey[],
  issues: Issue[],
  rules: ReadonlyArray<StringRule>,
) => {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    if (!rule) {
      continue;
    }

    if (rule.kind === "min") {
      if (value.length < rule.length) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "max") {
      if (value.length > rule.length) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "length") {
      if (value.length !== rule.length) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "regex") {
      rule.pattern.lastIndex = 0;

      if (!rule.pattern.test(value)) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "email") {
      if (!isEmail(value)) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "url") {
      if (!isUrlString(value)) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "uuid") {
      if (!isUuid(value)) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "startsWith") {
      if (!value.startsWith(rule.prefix)) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "endsWith") {
      if (!value.endsWith(rule.suffix)) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "includes") {
      if (!value.includes(rule.search)) {
        pushIssue(issues, rule.message, path);
        return;
      }
    }
  }
};

export const applyNumberRules = (
  value: number,
  path: PropertyKey[],
  issues: Issue[],
  rules: ReadonlyArray<NumberRule>,
  integerOnly: boolean,
  integerMessage: string,
) => {
  if (!Number.isFinite(value)) {
    pushIssue(issues, "Expected finite number", path);
    return;
  }

  if (integerOnly) {
    if (!Number.isInteger(value)) {
      pushIssue(issues, integerMessage, path);
      return;
    }
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    if (!rule) {
      continue;
    }

    if (rule.kind === "min") {
      if (value < rule.value) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "max") {
      if (value > rule.value) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "positive") {
      if (value <= 0) {
        pushIssue(issues, rule.message, path);
        return;
      }
      continue;
    }

    if (rule.kind === "nonnegative") {
      if (value < 0) {
        pushIssue(issues, rule.message, path);
        return;
      }
    }
  }
};

const isIdentKey = (key: string) => {
  return IDENT_KEY_PATTERN.test(key);
};

/**
 * Extra path segments relative to the runtime `path` cursor.
 * `emitIssue` prepends `path` so composites keep their prefix.
 */
export const formatPathExpr = (
  prefix: PropertyKey[],
  dynamic?: string,
): string | null => {
  const segments = prefix.map((part) => JSON.stringify(part));

  if (dynamic !== undefined) {
    segments.push(dynamic);
  }

  if (segments.length === 0) {
    return null;
  }

  return segments.join(",");
};

export const emitIssue = (messageLit: string, segments: string | null) => {
  if (!segments) {
    return `issues.push(path.length===0?{message:${messageLit}}:{message:${messageLit},path:path.slice()});`;
  }

  return `issues.push({message:${messageLit},path:[...path,${segments}]});`;
};

export const emitStringRules = (
  expr: string,
  pathPrefix: PropertyKey[],
  rules: ReadonlyArray<StringRule>,
  binds: unknown[],
  dynamicIndex?: string,
) => {
  const pathExpr = formatPathExpr(pathPrefix, dynamicIndex);
  const parts = [
    `if(typeof ${expr}!=='string'){${emitIssue('"Expected string"', pathExpr)}}`,
  ];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    if (!rule) {
      continue;
    }

    const msg = JSON.stringify(rule.message);

    if (rule.kind === "min") {
      parts.push(
        `else if(${expr}.length<${rule.length}){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "max") {
      parts.push(
        `else if(${expr}.length>${rule.length}){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "length") {
      parts.push(
        `else if(${expr}.length!==${rule.length}){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "regex") {
      const id = binds.length;
      binds.push(rule.pattern);
      parts.push(
        `else if((binds[${id}].lastIndex=0,!binds[${id}].test(${expr}))){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "email") {
      const id = binds.length;
      binds.push(isEmail);
      parts.push(
        `else if(!binds[${id}](${expr})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "url") {
      const id = binds.length;
      binds.push(isUrlString);
      parts.push(
        `else if(!binds[${id}](${expr})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "uuid") {
      const id = binds.length;
      binds.push(isUuid);
      parts.push(
        `else if(!binds[${id}](${expr})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "startsWith") {
      parts.push(
        `else if(!${expr}.startsWith(${JSON.stringify(rule.prefix)})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "endsWith") {
      parts.push(
        `else if(!${expr}.endsWith(${JSON.stringify(rule.suffix)})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "includes") {
      parts.push(
        `else if(!${expr}.includes(${JSON.stringify(rule.search)})){${emitIssue(msg, pathExpr)}}`,
      );
    }
  }

  return parts.join("");
};

export const emitNumberRules = (
  expr: string,
  pathPrefix: PropertyKey[],
  rules: ReadonlyArray<NumberRule>,
  integerOnly: boolean,
  integerMessage: string,
  dynamicIndex?: string,
) => {
  const pathExpr = formatPathExpr(pathPrefix, dynamicIndex);
  const parts = [
    `if(typeof ${expr}!=='number'){${emitIssue('"Expected number"', pathExpr)}}else if(!Number.isFinite(${expr})){${emitIssue('"Expected finite number"', pathExpr)}}`,
  ];

  if (integerOnly) {
    parts.push(
      `else if(!Number.isInteger(${expr})){${emitIssue(JSON.stringify(integerMessage), pathExpr)}}`,
    );
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    if (!rule) {
      continue;
    }

    const msg = JSON.stringify(rule.message);

    if (rule.kind === "min") {
      parts.push(`else if(${expr}<${rule.value}){${emitIssue(msg, pathExpr)}}`);
      continue;
    }

    if (rule.kind === "max") {
      parts.push(`else if(${expr}>${rule.value}){${emitIssue(msg, pathExpr)}}`);
      continue;
    }

    if (rule.kind === "positive") {
      parts.push(`else if(${expr}<=0){${emitIssue(msg, pathExpr)}}`);
      continue;
    }

    if (rule.kind === "nonnegative") {
      parts.push(`else if(${expr}<0){${emitIssue(msg, pathExpr)}}`);
    }
  }

  return parts.join("");
};

export const compileObjectValidate = <Output>(fields: ObjectField[]) => {
  const runs: RunFn<unknown>[] = [];
  const binds: unknown[] = [];
  let needsPath = false;

  const lines = [
    `if(typeof value!=='object'||value===null||Array.isArray(value)){${emitIssue('"Expected object"', null)}return value;}`,
  ];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    if (!field) {
      continue;
    }

    const keyLiteral = JSON.stringify(field.key);
    const access = isIdentKey(field.key)
      ? `value.${field.key}`
      : `value[${keyLiteral}]`;
    const hasKey = `Object.hasOwn(value,${keyLiteral})`;
    const fieldPrefix: PropertyKey[] = [field.key];

    lines.push(`if(!${hasKey}){`);

    if (!field.optional) {
      lines.push(emitIssue('"Required"', formatPathExpr(fieldPrefix)));
    }

    const inline = field.toInline(access, fieldPrefix, binds);

    if (inline) {
      lines.push("}else{", inline, "}");
      continue;
    }

    needsPath = true;
    const runIndex = runs.length;
    runs.push(field.run);
    lines.push(
      "}else{",
      `path.push(${keyLiteral});`,
      `runs[${runIndex}](${access},path,issues);`,
      "path.pop();",
      "}",
    );
  }

  const factory = new Function(
    "binds",
    "runs",
    `return function(value,path,issues){${lines.join("")}return value;}`,
  );

  const run = factory(binds, runs) as RunFn<Output>;

  if (needsPath) {
    return {
      needsPath: true as const,
      run,
    };
  }

  return {
    needsPath: false as const,
    check: run as (
      value: unknown,
      path: PropertyKey[],
      issues: Issue[],
    ) => void,
    run,
  };
};
