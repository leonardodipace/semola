export type Action = "read" | "create" | "update" | "delete" | (string & {});

export type ConditionValue<V> = V | ((value: V) => boolean);

export type Conditions<T = Record<string, unknown>> = {
  [K in keyof T]?: ConditionValue<T[K]>;
};

export type Rule<T = Record<string, unknown>> = {
  action: Action;
  conditions?: Conditions<T>;
  inverted: boolean;
  reason?: string;
};

export type AllowParams<T = Record<string, unknown>> = {
  action: Action | Action[];
  conditions?: Conditions<T>;
  reason?: string;
};

export type ForbidParams<T = Record<string, unknown>> = {
  action: Action | Action[];
  conditions?: Conditions<T>;
  reason?: string;
};

export type CanResult = {
  allowed: boolean;
  reason?: string;
};
