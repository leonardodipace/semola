import { mightThrow } from "../../errors/index.js";
import { PromptCancelledError, PromptIOError } from "../errors.js";
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

const resolveOutput = async <TValue>(
  options: BasePromptOptions<TValue>,
  value: TValue,
) => {
  if (!options.transform) {
    return value;
  }

  const [transformError, transformed] = await mightThrow(
    Promise.resolve().then(() => options.transform?.(value)),
  );

  if (transformError || transformed === null || transformed === undefined) {
    throw new PromptIOError("Prompt transform callback failed unexpectedly");
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

  const [validationError, validationMessage] = await mightThrow(
    Promise.resolve().then(() => options.validate?.(value)),
  );

  if (validationError) {
    throw new PromptIOError("Prompt validate callback failed unexpectedly");
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

  const [sessionError, finalValue] = await mightThrow(
    (async () => {
      while (true) {
        params.runtime.render(
          params.render({
            options: params.options,
            state,
            errorMessage,
          }),
        );

        const key = await params.runtime.readKey();

        if (!key) {
          throw new PromptIOError("Unable to read prompt input");
        }

        if (isCancelKey(key)) {
          params.runtime.close();
          params.runtime.done(`✖ ${CANCEL_MESSAGE}`);

          if (params.runtime.interrupt) {
            params.runtime.interrupt(CANCEL_MESSAGE);
          }

          throw new PromptCancelledError(CANCEL_MESSAGE);
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

        const validationErrorMessage = await runValidation(
          params.options,
          rawValue,
        );

        if (validationErrorMessage) {
          errorMessage = validationErrorMessage;
          continue;
        }

        const outputValue = await resolveOutput(params.options, rawValue);

        if (outputValue === null) {
          throw new PromptIOError("Unable to transform prompt value");
        }

        closeAndDone(
          params.complete({
            options: params.options,
            state,
            value: outputValue,
          }),
        );

        return outputValue;
      }
    })(),
  );

  if (sessionError) {
    params.runtime.close();
    throw sessionError;
  }

  return finalValue;
};
