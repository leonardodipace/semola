import type { ConditionHelper } from "./helpers.js";

export type Action = "read" | "create" | "update" | "delete" | (string & {});

export type ConditionValue<V> =
  V extends Record<string, unknown>
    ? ConditionHelper<V> | Conditions<V>
    : ConditionHelper<V>;

export type Conditions<T = Record<string, unknown>> = {
  [K in keyof T]?: ConditionValue<T[K]>;
};

export type Rule<T = Record<string, unknown>> = {
  action: Action;
  conditions?: Conditions<T>;
  inverted: boolean;
  reason?: string;
};

type PolicyRuleParams<T = Record<string, unknown>> = {
  action: Action | Action[];
  conditions?: Conditions<T>;
  reason?: string;
};

export type AllowParams<T = Record<string, unknown>> = PolicyRuleParams<T>;

export type ForbidParams<T = Record<string, unknown>> = PolicyRuleParams<T>;

export type CanResult = {
  allowed: boolean;
  reason?: string;
};
