export type Action = string;
export type Entity = string;

export type Conditions<T = any> = Partial<T>;

export type Rule<T = any> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
  inverted: boolean;
};

export type AllowParams<T = any> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
};

export type ForbidParams<T = any> = {
  action: Action;
  entity: Entity;
  conditions?: Conditions<T>;
};
