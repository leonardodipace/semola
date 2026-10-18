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

/** RFC 4122 / 9562 UUID (version 1-8, variant 10xx). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IDENT_KEY_PATTERN = /^[A-Za-z_$][\w$]*$/;

/** Space and ASCII control characters (rejected in emails). */
const ASCII_SPACE_CODE = 32;

export const isUuid = (value: string) => {
  return UUID_PATTERN.test(value);
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

export const isEmail = (value: string) => {
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
      try {
        new URL(value);
      } catch {
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

/** Issue path as a JS expression, or null at the root. */
export const formatPathExpr = (
  prefix: PropertyKey[],
  dynamic?: string,
): string | null => {
  if (dynamic === undefined) {
    if (prefix.length === 0) {
      return null;
    }

    return JSON.stringify(prefix);
  }

  if (prefix.length === 0) {
    return `[${dynamic}]`;
  }

  const head = prefix.map((part) => JSON.stringify(part)).join(",");
  return `[${head},${dynamic}]`;
};

export const emitIssue = (messageLit: string, pathExpr: string | null) => {
  if (!pathExpr) {
    return `issues.push({message:${messageLit}});`;
  }

  return `issues.push({message:${messageLit},path:${pathExpr}});`;
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
    `if(typeof ${expr}!=='string'){${emitIssue('"Expected string"', pathExpr)}}else{`,
  ];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    if (!rule) {
      continue;
    }

    const msg = JSON.stringify(rule.message);

    if (rule.kind === "min") {
      parts.push(
        `if(${expr}.length<${rule.length}){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "max") {
      parts.push(
        `if(${expr}.length>${rule.length}){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "length") {
      parts.push(
        `if(${expr}.length!==${rule.length}){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "regex") {
      const id = binds.length;
      binds.push(rule.pattern);
      parts.push(
        `binds[${id}].lastIndex=0;if(!binds[${id}].test(${expr})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "email") {
      const id = binds.length;
      binds.push(isEmail);
      parts.push(`if(!binds[${id}](${expr})){${emitIssue(msg, pathExpr)}}`);
      continue;
    }

    if (rule.kind === "url") {
      parts.push(`try{new URL(${expr})}catch{${emitIssue(msg, pathExpr)}}`);
      continue;
    }

    if (rule.kind === "uuid") {
      const id = binds.length;
      binds.push(isUuid);
      parts.push(`if(!binds[${id}](${expr})){${emitIssue(msg, pathExpr)}}`);
      continue;
    }

    if (rule.kind === "startsWith") {
      parts.push(
        `if(!${expr}.startsWith(${JSON.stringify(rule.prefix)})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "endsWith") {
      parts.push(
        `if(!${expr}.endsWith(${JSON.stringify(rule.suffix)})){${emitIssue(msg, pathExpr)}}`,
      );
      continue;
    }

    if (rule.kind === "includes") {
      parts.push(
        `if(!${expr}.includes(${JSON.stringify(rule.search)})){${emitIssue(msg, pathExpr)}}`,
      );
    }
  }

  parts.push("}");
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
  const pathExprRoot = formatPathExpr([]);
  let needsPath = false;

  const lines = [
    `if(typeof value!=='object'||value===null||Array.isArray(value)){${emitIssue('"Expected object"', pathExprRoot)}return value;}`,
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
    const hasKey = `${keyLiteral} in value`;
    const fieldPrefix: PropertyKey[] = [field.key];
    const requiredPath = formatPathExpr(fieldPrefix);

    lines.push(`if(!(${hasKey})){`);

    if (!field.optional) {
      lines.push(emitIssue('"Required"', requiredPath));
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
    needsPath
      ? `return function(value,path,issues){${lines.join("")}return value;}`
      : `return function(value,issues){${lines.join("")}}`,
  );

  if (needsPath) {
    return {
      needsPath: true as const,
      run: factory(binds, runs) as RunFn<Output>,
    };
  }

  const check = factory(binds, runs) as (
    value: unknown,
    issues: Issue[],
  ) => void;

  return {
    needsPath: false as const,
    check,
    run: ((value, _path, issues) => {
      check(value, issues);
      return value as Output;
    }) as RunFn<Output>,
  };
};
