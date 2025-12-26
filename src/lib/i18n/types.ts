// Parameter extraction from template strings
export type ExtractParamType<T extends string> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : T extends "boolean"
      ? boolean
      : never;

export type BuildParamObject<
  T extends string,
  Acc = {},
> = T extends `${infer _Start}{${infer Name}:${infer Type}}${infer Rest}`
  ? BuildParamObject<Rest, Acc & Record<Name, ExtractParamType<Type>>>
  : Acc;

// Type guards
type IsString<T> = T extends string ? true : false;
type IsArray<T> = T extends readonly unknown[] ? true : false;
type IsObject<T> = T extends object
  ? T extends readonly unknown[]
    ? false
    : true
  : false;

// Generate numeric indices for arrays (e.g., "0" | "1" | "2")
type ArrayKeys<T extends readonly unknown[]> = {
  [K in keyof T & `${number}`]: `${K}`;
}[keyof T & `${number}`];

// Generate translation keys for a single object property
type ObjectPropertyKeys<K extends string, V> = IsString<V> extends true
  ? K
  : IsArray<V> extends true
    ? V extends readonly unknown[]
      ? `${K}.${NestedKeyOf<V>}`
      : never
    : IsObject<V> extends true
      ? `${K}.${NestedKeyOf<V>}`
      : never;

// Recursively generate all valid translation keys
export type NestedKeyOf<T> =
  IsArray<T> extends true
    ? T extends readonly unknown[]
      ? ArrayKeys<T>
      : never
    : IsObject<T> extends true
      ? {
          [K in keyof T & string]: ObjectPropertyKeys<K, T[K]>;
        }[keyof T & string]
      : never;

// Extract value at a nested key path
export type GetNestedValue<
  T,
  K extends string,
> = K extends `${infer First}.${infer Rest}`
  ? First extends keyof T
    ? GetNestedValue<T[First], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;
