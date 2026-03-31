import type { BasePromptOptions } from "../types.js";
import type { Key, PromptRuntime } from "./types.js";

type SubmitResult<TValue> =
  | {
      value: TValue;
    }
  | {
      errorMessage: string;
    };

type SessionOptions<
  TState,
  TValue,
  TOptions extends BasePromptOptions<TValue>,
> = {
  runtime: PromptRuntime;
  options: TOptions;
  initialState: TState;
  render: (params: {
    options: TOptions;
    state: TState;
    errorMessage: string | null;
  }) => string;
  complete: (params: {
    options: TOptions;
    state: TState;
    value: TValue;
  }) => string;
  onKey: (state: TState, key: Key) => TState;
  onSubmit: (state: TState) => SubmitResult<TValue>;
};

const CANCEL_MESSAGE = "Interrupted, bye!";

const toError = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.length > 0) {
    return error;
  }

  return new Error(fallback);
};

const resolveOutput = async <TValue>(
  options: BasePromptOptions<TValue>,
  value: TValue,
) => {
  if (!options.transform) {
    return value;
  }

  let transformed: TValue;

  try {
    transformed = await Promise.resolve(options.transform(value));
  } catch {
    throw new Error("Prompt transform callback failed unexpectedly");
  }

  if (transformed === null || transformed === undefined) {
    throw new Error("Prompt transform callback failed unexpectedly");
  }

  return transformed;
};

const runValidation = async <TValue>(
  options: BasePromptOptions<TValue>,
  value: TValue,
) => {
  if (!options.validate) {
    return null;
  }

  let validationMessage: string | null | undefined;

  try {
    validationMessage = await Promise.resolve(options.validate(value));
  } catch {
    throw new Error("Prompt validate callback failed unexpectedly");
  }

  if (typeof validationMessage === "string" && validationMessage.length > 0) {
    return validationMessage;
  }

  return null;
};

const isCancelKey = (key: Key) => {
  if (key.name === "ctrl_c") return true;
  if (key.name === "escape") return true;

  return false;
};

export const runPromptSession = async <
  TState,
  TValue,
  TOptions extends BasePromptOptions<TValue>,
>(
  params: SessionOptions<TState, TValue, TOptions>,
) => {
  params.runtime.init();

  let state = params.initialState;
  let errorMessage: string | null = null;

  const closeAndDone = (message: string) => {
    params.runtime.close();
    params.runtime.done(message);
  };

  while (true) {
    try {
      params.runtime.render(
        params.render({
          options: params.options,
          state,
          errorMessage,
        }),
      );
    } catch (error) {
      try {
        params.runtime.close();
      } catch {
        // Best effort close after render failure.
      }

      throw toError(error, "Unable to render prompt frame");
    }

    let key: Key;

    try {
      key = await params.runtime.readKey();
    } catch (error) {
      try {
        params.runtime.close();
      } catch {
        // Best effort close after read failure.
      }

      throw toError(error, "Unable to read prompt input");
    }

    if (isCancelKey(key)) {
      params.runtime.close();
      params.runtime.done(`✖ ${CANCEL_MESSAGE}`);

      params.runtime.interrupt?.(CANCEL_MESSAGE);

      throw new Error(CANCEL_MESSAGE);
    }

    if (key.name !== "enter") {
      state = params.onKey(state, key);
      errorMessage = null;
      continue;
    }

    const submitResult = params.onSubmit(state);

    if ("errorMessage" in submitResult) {
      errorMessage = submitResult.errorMessage;
      continue;
    }

    const rawValue = submitResult.value;
    let validationErrorMessage: string | null;

    try {
      validationErrorMessage = await runValidation(params.options, rawValue);
    } catch (error) {
      closeAndDone(`✖ ${params.options.message}`);
      throw toError(error, "Prompt validate callback failed unexpectedly");
    }

    if (validationErrorMessage) {
      errorMessage = validationErrorMessage;
      continue;
    }

    let finalValue: TValue;

    try {
      finalValue = await resolveOutput(params.options, rawValue);
    } catch (error) {
      closeAndDone(`✖ ${params.options.message}`);
      throw toError(error, "Unable to transform prompt value");
    }

    closeAndDone(
      params.complete({
        options: params.options,
        state,
        value: finalValue,
      }),
    );

    return finalValue;
  }
};
