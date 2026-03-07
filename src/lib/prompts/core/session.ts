import { err, mightThrow, ok } from "../../errors/index.js";
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
    return ok(value);
  }

  const [transformError, transformed] = await mightThrow(
    Promise.resolve().then(() => options.transform?.(value)),
  );

  if (transformError || transformed === null || transformed === undefined) {
    return err(
      "PromptIOError",
      "Prompt transform callback failed unexpectedly",
    );
  }

  return ok(transformed);
};

const runValidation = async <TValue>(
  options: BasePromptOptions<TValue>,
  value: TValue,
) => {
  if (!options.validate) {
    return ok(null);
  }

  const [validationError, validationMessage] = await mightThrow(
    Promise.resolve().then(() => options.validate?.(value)),
  );

  if (validationError) {
    return err("PromptIOError", "Prompt validate callback failed unexpectedly");
  }

  if (typeof validationMessage === "string" && validationMessage.length > 0) {
    return ok(validationMessage);
  }

  return ok(null);
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
  const [initError] = params.runtime.init();

  if (initError) {
    return err(initError.type, initError.message);
  }

  let state = params.initialState;
  let errorMessage: string | null = null;

  while (true) {
    const [renderError] = params.runtime.render(
      params.render({
        options: params.options,
        state,
        errorMessage,
      }),
    );

    if (renderError) {
      return err(renderError.type, renderError.message);
    }

    const [readError, key] = await params.runtime.readKey();

    if (readError || !key) {
      return err(
        readError?.type ?? "PromptIOError",
        readError?.message ?? "Unable to read prompt input",
      );
    }

    if (isCancelKey(key)) {
      const [closeError] = params.runtime.close();

      if (closeError) {
        return err(closeError.type, closeError.message);
      }

      const [doneError] = params.runtime.done(`✖ ${CANCEL_MESSAGE}`);

      if (doneError) {
        return err(doneError.type, doneError.message);
      }

      if (params.runtime.interrupt) {
        const [interruptError] = params.runtime.interrupt(CANCEL_MESSAGE);

        if (interruptError) {
          return err(interruptError.type, interruptError.message);
        }
      }

      return err("PromptCancelledError", CANCEL_MESSAGE);
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

    const [validationRunError, validationErrorMessage] = await runValidation(
      params.options,
      rawValue,
    );

    if (validationRunError) {
      const [closeErr] = params.runtime.close();

      if (closeErr) {
        return err(closeErr.type, closeErr.message);
      }

      const [doneErr] = params.runtime.done(`✖ ${params.options.message}`);

      if (doneErr) {
        return err(doneErr.type, doneErr.message);
      }

      return err(validationRunError.type, validationRunError.message);
    }

    if (validationErrorMessage) {
      errorMessage = validationErrorMessage;
      continue;
    }

    const [transformError, finalValue] = await resolveOutput(
      params.options,
      rawValue,
    );

    if (transformError) {
      const [closeErr] = params.runtime.close();

      if (closeErr) {
        return err(closeErr.type, closeErr.message);
      }

      const [doneErr] = params.runtime.done(`✖ ${params.options.message}`);

      if (doneErr) {
        return err(doneErr.type, doneErr.message);
      }

      return err(transformError.type, transformError.message);
    }

    if (finalValue === null) {
      return err("PromptIOError", "Unable to transform prompt value");
    }

    const [closeError] = params.runtime.close();

    if (closeError) {
      return err(closeError.type, closeError.message);
    }

    const [doneError] = params.runtime.done(
      params.complete({
        options: params.options,
        state,
        value: finalValue,
      }),
    );

    if (doneError) {
      return err(doneError.type, doneError.message);
    }

    return ok(finalValue);
  }
};
