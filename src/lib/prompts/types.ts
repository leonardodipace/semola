export type PromptErrorType =
  | "PromptEnvironmentError"
  | "PromptValidationError"
  | "PromptCancelledError"
  | "PromptIOError"
  | (string & {});

export type MaybePromise<T> = T | Promise<T>;

export type Validate<TValue> =
  | ((value: TValue) => MaybePromise<string | null | undefined>)
  | undefined;

export type Transform<TValue> =
  | ((value: TValue) => MaybePromise<TValue>)
  | undefined;

export type BasePromptOptions<TValue> = {
  message: string;
  validate?: Validate<TValue>;
  transform?: Transform<TValue>;
};

export type InputOptions = BasePromptOptions<string> & {
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  requiredMessage?: string;
};

export type PasswordOptions = InputOptions & {
  mask?: string;
};

export type ConfirmOptions = BasePromptOptions<boolean> & {
  defaultValue?: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
};

export type NumberOptions = BasePromptOptions<number> & {
  defaultValue?: number;
  min?: number;
  max?: number;
  requiredMessage?: string;
  invalidMessage?: string;
  minMessage?: string;
  maxMessage?: string;
};

export type SelectChoice<TValue extends string> = {
  value: TValue;
  label?: string;
  hint?: string;
  disabled?: boolean;
};

export type SelectOptions<TValue extends string> = BasePromptOptions<TValue> & {
  choices: readonly [SelectChoice<TValue>, ...SelectChoice<TValue>[]];
  defaultValue?: TValue;
};

export type MultiselectOptions<TValue extends string> = BasePromptOptions<
  TValue[]
> & {
  choices: readonly [SelectChoice<TValue>, ...SelectChoice<TValue>[]];
  defaultValue?: readonly TValue[];
  min?: number;
  max?: number;
};
