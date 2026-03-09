const _brand = Symbol("conditionHelper");

export type ConditionHelper<V> = {
  readonly [_brand]: (actual: V) => boolean;
  operator: string;
  value: unknown;
  fn: (actual: V) => boolean;
};

export const eq = <V>(value: V): ConditionHelper<V> => {
  const fn = (actual: V) => actual === value;

  return {
    [_brand]: fn,
    operator: "eq",
    value,
    fn,
  };
};

export const neq = <V>(value: V): ConditionHelper<V> => {
  const fn = (actual: V) => actual !== value;

  return {
    [_brand]: fn,
    operator: "neq",
    value,
    fn,
  };
};

export const gt = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual > value;

  return {
    [_brand]: fn,
    operator: "gt",
    value,
    fn,
  };
};

export const gte = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual >= value;

  return {
    [_brand]: fn,
    operator: "gte",
    value,
    fn,
  };
};

export const lt = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual < value;

  return {
    [_brand]: fn,
    operator: "lt",
    value,
    fn,
  };
};

export const lte = (
  value: string | number | Date,
): ConditionHelper<string | number | Date> => {
  const fn = (actual: string | number | Date) => actual <= value;

  return {
    [_brand]: fn,
    operator: "lte",
    value,
    fn,
  };
};

export const not = <V>(inner: ConditionHelper<V>): ConditionHelper<V> => {
  const fn = (actual: V) => !inner.fn(actual);

  return {
    [_brand]: fn,
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
    operator: "and",
    value: helpers,
    fn,
  };
};

export const or = <V>(...helpers: ConditionHelper<V>[]): ConditionHelper<V> => {
  const fn = (actual: V) => helpers.some((h) => h.fn(actual));

  return {
    [_brand]: fn,
    operator: "or",
    value: helpers,
    fn,
  };
};

export const startsWith = (prefix: string): ConditionHelper<string> => {
  const fn = (actual: string) => actual.startsWith(prefix);

  return {
    [_brand]: fn,
    operator: "startsWith",
    value: prefix,
    fn,
  };
};

export const endsWith = (suffix: string): ConditionHelper<string> => {
  const fn = (actual: string) => actual.endsWith(suffix);

  return {
    [_brand]: fn,
    operator: "endsWith",
    value: suffix,
    fn,
  };
};

export const includes = (substring: string): ConditionHelper<string> => {
  const fn = (actual: string) => actual.includes(substring);

  return {
    [_brand]: fn,
    operator: "includes",
    value: substring,
    fn,
  };
};

export const matches = (pattern: RegExp): ConditionHelper<string> => {
  const fn = (actual: string) => pattern.test(actual);

  return {
    [_brand]: fn,
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
    operator: "has",
    value: items,
    fn,
  };
};

export const hasAny = <V>(items: V[]): ConditionHelper<V[]> => {
  const fn = (actual: V[]) => items.some((item) => actual.includes(item));

  return {
    [_brand]: fn,
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
    operator: "hasLength",
    value: length,
    fn,
  };
};

export const isEmpty = (): ConditionHelper<string | unknown[]> => {
  const fn = (actual: string | unknown[]) => actual.length === 0;

  return {
    [_brand]: fn,
    operator: "isEmpty",
    value: undefined,
    fn,
  };
};

export const isDefined = (): ConditionHelper<unknown> => {
  const fn = (actual: unknown) => actual !== null && actual !== undefined;

  return {
    [_brand]: fn,
    operator: "isDefined",
    value: undefined,
    fn,
  };
};

export const isNullish = (): ConditionHelper<unknown> => {
  const fn = (actual: unknown) => actual === null || actual === undefined;

  return {
    [_brand]: fn,
    operator: "isNullish",
    value: undefined,
    fn,
  };
};
