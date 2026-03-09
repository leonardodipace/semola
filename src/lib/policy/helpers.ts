const _brand = Symbol("conditionHelper");

export type ConditionHelper<V> = {
  readonly [_brand]: (actual: V) => boolean;
  __isConditionHelper: true;
  operator: string;
  value: unknown;
  fn: (actual: V) => boolean;
};

export const eq = <V>(value: V): ConditionHelper<V> => {
  const fn = (actual: V) => actual === value;

  return { [_brand]: fn, __isConditionHelper: true, operator: "eq", value, fn };
};

export const neq = <V>(value: V): ConditionHelper<V> => {
  const fn = (actual: V) => actual !== value;

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "neq",
    value,
    fn,
  };
};

export const gt = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual > value;

  return { [_brand]: fn, __isConditionHelper: true, operator: "gt", value, fn };
};

export const gte = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual >= value;

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "gte",
    value,
    fn,
  };
};

export const lt = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual < value;

  return { [_brand]: fn, __isConditionHelper: true, operator: "lt", value, fn };
};

export const lte = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual <= value;

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "lte",
    value,
    fn,
  };
};

export const not = <V>(inner: ConditionHelper<V>): ConditionHelper<V> => {
  const fn = (actual: V) => !inner.fn(actual);

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "not",
    value: inner,
    fn,
  };
};

export const and = <V>(
  ...helpers: ConditionHelper<V>[]
): ConditionHelper<V> => {
  const fn = (actual: V) => helpers.every((h) => h.fn(actual));

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "and",
    value: helpers,
    fn,
  };
};

export const or = <V>(...helpers: ConditionHelper<V>[]): ConditionHelper<V> => {
  const fn = (actual: V) => helpers.some((h) => h.fn(actual));

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "or",
    value: helpers,
    fn,
  };
};

export const startsWith = (prefix: string): ConditionHelper<string> => {
  const fn = (actual: string) => actual.startsWith(prefix);

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "startsWith",
    value: prefix,
    fn,
  };
};

export const endsWith = (suffix: string): ConditionHelper<string> => {
  const fn = (actual: string) => actual.endsWith(suffix);

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "endsWith",
    value: suffix,
    fn,
  };
};

export const includes = (substring: string): ConditionHelper<string> => {
  const fn = (actual: string) => actual.includes(substring);

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "includes",
    value: substring,
    fn,
  };
};

export const matches = (pattern: RegExp): ConditionHelper<string> => {
  const fn = (actual: string) => pattern.test(actual);

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "matches",
    value: pattern,
    fn,
  };
};

export const has = <V>(items: V | V[]): ConditionHelper<V[]> => {
  const fn = (actual: V[]) => {
    if (Array.isArray(items)) {
      return items.every((item) => actual.includes(item));
    }

    return actual.includes(items);
  };

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "has",
    value: items,
    fn,
  };
};

export const hasAny = <V>(items: V[]): ConditionHelper<V[]> => {
  const fn = (actual: V[]) => items.some((item) => actual.includes(item));

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "hasAny",
    value: items,
    fn,
  };
};

type HasLengthArg = number | { min?: number; max?: number };

export const hasLength = (
  length: HasLengthArg,
): ConditionHelper<string | unknown[]> => {
  const fn = (actual: string | unknown[]) => {
    const len = actual.length;

    if (typeof length === "number") {
      return len === length;
    }

    if (length.min !== undefined && len < length.min) {
      return false;
    }

    if (length.max !== undefined && len > length.max) {
      return false;
    }

    return true;
  };

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "hasLength",
    value: length,
    fn,
  };
};

export const isEmpty = (): ConditionHelper<string | unknown[]> => {
  const fn = (actual: string | unknown[]) => actual.length === 0;

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "isEmpty",
    value: undefined,
    fn,
  };
};

export const isDefined = (): ConditionHelper<unknown> => {
  const fn = (actual: unknown) => actual !== null && actual !== undefined;

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "isDefined",
    value: undefined,
    fn,
  };
};

export const isNullish = (): ConditionHelper<unknown> => {
  const fn = (actual: unknown) => actual === null || actual === undefined;

  return {
    [_brand]: fn,
    __isConditionHelper: true,
    operator: "isNullish",
    value: undefined,
    fn,
  };
};
