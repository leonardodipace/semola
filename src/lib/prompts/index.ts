import { styleText } from "node:util";
import { createNodePromptRuntime } from "./core/runtime.js";
import { runPromptSession } from "./core/session.js";
import type { PromptRuntime } from "./core/types.js";
import type {
  ConfirmOptions,
  InputOptions,
  MultiselectOptions,
  NumberOptions,
  PasswordOptions,
  SelectOptions,
} from "./types.js";

const pointer = (active: boolean) => {
  return active ? paint("cyan", "❯") : " ";
};

const addErrorLine = (content: string, errorMessage: string | null) => {
  if (!errorMessage) {
    return content;
  }

  return `${content}\n${errorMark()} ${paint("red", errorMessage)}`;
};

const insertAt = (value: string, at: number, character: string) => {
  return `${value.slice(0, at)}${character}${value.slice(at)}`;
};

const INVERSE = "\u001B[7m";
const RESET = "\u001B[0m";
const WHITESPACE = /\s/;
const CURSOR_BLOCK = `${INVERSE} ${RESET}`;
const paint = (
  color: "cyan" | "green" | "red" | "yellow" | "dim",
  text: string,
) => {
  return styleText(color, text, { validateStream: false });
};

const questionMark = () => paint("cyan", "?");
const successMark = () => paint("green", "✔");
const errorMark = () => paint("red", "✖");

const renderQuestionLine = (message: string, content: string) => {
  return `${questionMark()} ${paint("cyan", message)} ${content}`;
};

const renderSuccessLine = (message: string, content: string) => {
  return `${successMark()} ${message} ${content}`;
};

type TextState = {
  value: string;
  cursor: number;
  selectionAnchor: number | null;
};

const createTextState = (value: string): TextState => {
  return {
    value,
    cursor: value.length,
    selectionAnchor: null,
  };
};

const submitTextValue = (
  state: TextState,
  options: {
    defaultValue?: string;
    required?: boolean;
    requiredMessage?: string;
  },
) => {
  const value =
    state.value.length > 0 ? state.value : (options.defaultValue ?? "");

  if (options.required && value.trim().length === 0) {
    return { errorMessage: options.requiredMessage ?? "A value is required" };
  }

  return { value };
};

const getSelectionRange = (state: TextState) => {
  if (
    state.selectionAnchor === null ||
    state.selectionAnchor === state.cursor
  ) {
    return null;
  }

  return {
    start: Math.min(state.selectionAnchor, state.cursor),
    end: Math.max(state.selectionAnchor, state.cursor),
  };
};

const moveCursor = (
  state: TextState,
  cursor: number,
  keepSelection: boolean,
) => {
  if (!keepSelection) {
    return {
      ...state,
      cursor,
      selectionAnchor: null,
    };
  }

  return {
    ...state,
    cursor,
    selectionAnchor: state.selectionAnchor ?? state.cursor,
  };
};

const deleteRange = (
  state: TextState,
  start: number,
  end: number,
): TextState => {
  return {
    value: `${state.value.slice(0, start)}${state.value.slice(end)}`,
    cursor: start,
    selectionAnchor: null,
  };
};

const deleteSelectedRange = (state: TextState) => {
  const selection = getSelectionRange(state);

  if (!selection) {
    return state;
  }

  return deleteRange(state, selection.start, selection.end);
};

const findWordStart = (value: string, cursor: number) => {
  let index = cursor;

  while (index > 0 && WHITESPACE.test(value[index - 1] ?? "")) {
    index -= 1;
  }

  while (index > 0 && !WHITESPACE.test(value[index - 1] ?? "")) {
    index -= 1;
  }

  return index;
};

const findWordEnd = (value: string, cursor: number) => {
  let index = cursor;

  while (index < value.length && WHITESPACE.test(value[index] ?? "")) {
    index += 1;
  }

  while (index < value.length && !WHITESPACE.test(value[index] ?? "")) {
    index += 1;
  }

  return index;
};

const renderTextSelection = (state: TextState, mask?: string) => {
  const selection = getSelectionRange(state);
  const content = mask ? mask.repeat(state.value.length) : state.value;
  const boundedCursor = Math.max(0, Math.min(state.cursor, content.length));

  if (!selection) {
    if (content.length === 0) {
      return CURSOR_BLOCK;
    }

    if (boundedCursor === content.length) {
      return `${content}${CURSOR_BLOCK}`;
    }

    const focusedChar = content[boundedCursor] ?? " ";

    return `${content.slice(0, boundedCursor)}${INVERSE}${focusedChar}${RESET}${content.slice(boundedCursor + 1)}`;
  }

  const selected = content.slice(selection.start, selection.end);

  return `${content.slice(0, selection.start)}${INVERSE}${selected}${RESET}${content.slice(selection.end)}`;
};

const textOnKey = (
  state: TextState,
  key: {
    name: string;
    value?: string;
  },
) => {
  if (key.name === "ctrl_a") {
    return {
      ...state,
      cursor: state.value.length,
      selectionAnchor: 0,
    };
  }

  if (key.name === "home") {
    return moveCursor(state, 0, false);
  }

  if (key.name === "end") {
    return moveCursor(state, state.value.length, false);
  }

  if (key.name === "shift_ctrl_left") {
    return moveCursor(state, findWordStart(state.value, state.cursor), true);
  }

  if (key.name === "shift_ctrl_right") {
    return moveCursor(state, findWordEnd(state.value, state.cursor), true);
  }

  if (key.name === "left") {
    return moveCursor(state, Math.max(state.cursor - 1, 0), false);
  }

  if (key.name === "shift_left") {
    return moveCursor(state, Math.max(state.cursor - 1, 0), true);
  }

  if (key.name === "right") {
    return moveCursor(
      state,
      Math.min(state.cursor + 1, state.value.length),
      false,
    );
  }

  if (key.name === "ctrl_left") {
    return moveCursor(state, findWordStart(state.value, state.cursor), false);
  }

  if (key.name === "ctrl_right") {
    return moveCursor(state, findWordEnd(state.value, state.cursor), false);
  }

  if (key.name === "shift_right") {
    return moveCursor(
      state,
      Math.min(state.cursor + 1, state.value.length),
      true,
    );
  }

  if (key.name === "backspace") {
    const selectionDeleted = deleteSelectedRange(state);

    if (selectionDeleted !== state) {
      return selectionDeleted;
    }

    if (state.cursor === 0) {
      return state;
    }

    const nextCursor = state.cursor - 1;

    return {
      value: `${state.value.slice(0, nextCursor)}${state.value.slice(state.cursor)}`,
      cursor: nextCursor,
      selectionAnchor: null,
    };
  }

  if (key.name === "ctrl_backspace") {
    const selectionDeleted = deleteSelectedRange(state);

    if (selectionDeleted !== state) {
      return selectionDeleted;
    }

    if (state.cursor === 0) {
      return state;
    }

    const nextCursor = findWordStart(state.value, state.cursor);
    return deleteRange(state, nextCursor, state.cursor);
  }

  if (key.name === "delete") {
    const selectionDeleted = deleteSelectedRange(state);

    if (selectionDeleted !== state) {
      return selectionDeleted;
    }

    return {
      ...state,
      value: `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`,
    };
  }

  if (key.name !== "character" && key.name !== "space") {
    return state;
  }

  const collapsed = deleteSelectedRange(state);
  const text = key.name === "space" ? " " : (key.value ?? "");

  return {
    value: insertAt(collapsed.value, collapsed.cursor, text),
    cursor: collapsed.cursor + 1,
    selectionAnchor: null,
  };
};

export const input = async (options: InputOptions, runtime?: PromptRuntime) => {
  const promptRuntime = runtime ?? createNodePromptRuntime();
  const initialValue = options.defaultValue ?? "";

  return runPromptSession<TextState, string, InputOptions>({
    runtime: promptRuntime,
    options,
    initialState: createTextState(initialValue),
    render: ({ options: currentOptions, state, errorMessage }) => {
      let text = renderTextSelection(state);

      if (state.value.length === 0 && currentOptions.placeholder) {
        text = `${CURSOR_BLOCK}${paint("dim", currentOptions.placeholder)}`;
      }

      return addErrorLine(
        renderQuestionLine(currentOptions.message, text),
        errorMessage,
      );
    },
    complete: ({ options: currentOptions, value }) => {
      return renderSuccessLine(currentOptions.message, value);
    },
    onKey: (state, key) => {
      return textOnKey(state, key);
    },
    onSubmit: (state) => submitTextValue(state, options),
  });
};

export const password = async (
  options: PasswordOptions,
  runtime?: PromptRuntime,
) => {
  const promptRuntime = runtime ?? createNodePromptRuntime();
  const initialValue = options.defaultValue ?? "";
  const mask = options.mask ?? "*";

  return runPromptSession<TextState, string, PasswordOptions>({
    runtime: promptRuntime,
    options,
    initialState: createTextState(initialValue),
    render: ({ options: currentOptions, state, errorMessage }) => {
      const visible = renderTextSelection(state, mask);
      return addErrorLine(
        renderQuestionLine(currentOptions.message, visible),
        errorMessage,
      );
    },
    complete: ({ options: currentOptions }) => {
      return renderSuccessLine(currentOptions.message, mask.repeat(8));
    },
    onKey: (state, key) => {
      return textOnKey(state, key);
    },
    onSubmit: (state) => submitTextValue(state, options),
  });
};

export const confirm = async (
  options: ConfirmOptions,
  runtime?: PromptRuntime,
) => {
  const promptRuntime = runtime ?? createNodePromptRuntime();
  const defaultValue = options.defaultValue ?? false;

  return runPromptSession<{ value: boolean }, boolean, ConfirmOptions>({
    runtime: promptRuntime,
    options,
    initialState: {
      value: defaultValue,
    },
    render: ({ options: currentOptions, state, errorMessage }) => {
      const yesLabel = currentOptions.activeLabel ?? "Yes";
      const noLabel = currentOptions.inactiveLabel ?? "No";
      const rendered = state.value ? yesLabel : noLabel;

      return addErrorLine(
        renderQuestionLine(currentOptions.message, `(${rendered})`),
        errorMessage,
      );
    },
    complete: ({ options: currentOptions, value }) => {
      const label = value
        ? (currentOptions.activeLabel ?? "Yes")
        : (currentOptions.inactiveLabel ?? "No");

      return renderSuccessLine(currentOptions.message, label);
    },
    onKey: (state, key) => {
      if (key.name === "left") {
        return { value: true };
      }

      if (key.name === "right") {
        return { value: false };
      }

      if (key.name === "space") {
        return { value: !state.value };
      }

      if (key.name === "character") {
        const lowered = (key.value ?? "").toLowerCase();

        if (lowered === "y") {
          return { value: true };
        }

        if (lowered === "n") {
          return { value: false };
        }
      }

      return state;
    },
    onSubmit: (state) => {
      return { value: state.value };
    },
  });
};

export const number = async (
  options: NumberOptions,
  runtime?: PromptRuntime,
) => {
  const promptRuntime = runtime ?? createNodePromptRuntime();
  const defaultValue =
    options.defaultValue === undefined ? "" : String(options.defaultValue);

  return runPromptSession<TextState, number, NumberOptions>({
    runtime: promptRuntime,
    options,
    initialState: createTextState(defaultValue),
    render: ({ options: currentOptions, state, errorMessage }) => {
      return addErrorLine(
        renderQuestionLine(currentOptions.message, renderTextSelection(state)),
        errorMessage,
      );
    },
    complete: ({ options: currentOptions, value }) => {
      return renderSuccessLine(currentOptions.message, String(value));
    },
    onKey: (state, key) => {
      const next = textOnKey(state, key);
      const isTextEntry = key.name === "character" || key.name === "space";

      if (!isTextEntry) {
        return next;
      }

      const value = key.name === "space" ? " " : (key.value ?? "");

      if (!/[0-9.-]/.test(value)) {
        return state;
      }

      if (value === "." && state.value.includes(".")) {
        return state;
      }

      if (value === "-") {
        let insertionIndex = state.cursor;

        if (state.selectionAnchor !== null) {
          insertionIndex = Math.min(state.selectionAnchor, state.cursor);
        }

        if (insertionIndex !== 0) return state;
        if (state.value.includes("-")) return state;
      }

      return next;
    },
    onSubmit: (state) => {
      const raw = state.value.trim();

      if (raw.length === 0) {
        return {
          errorMessage: options.requiredMessage ?? "A number is required",
        };
      }

      const parsed = Number(raw);

      if (!Number.isFinite(parsed)) {
        return {
          errorMessage: options.invalidMessage ?? "Please enter a valid number",
        };
      }

      if (options.min !== undefined && parsed < options.min) {
        return {
          errorMessage:
            options.minMessage ??
            `Number must be greater than or equal to ${options.min}`,
        };
      }

      if (options.max !== undefined && parsed > options.max) {
        return {
          errorMessage:
            options.maxMessage ??
            `Number must be lower than or equal to ${options.max}`,
        };
      }

      return { value: parsed };
    },
  });
};

const findFirstEnabledIndex = <TValue extends string>(
  choices: readonly {
    value: TValue;
    disabled?: boolean;
  }[],
) => {
  const firstEnabledIndex = choices.findIndex((choice) => !choice.disabled);

  if (firstEnabledIndex >= 0) {
    return firstEnabledIndex;
  }

  return 0;
};

const findNextEnabledIndex = <TValue extends string>(
  choices: readonly {
    value: TValue;
    disabled?: boolean;
  }[],
  cursor: number,
  direction: 1 | -1,
) => {
  const total = choices.length;
  let currentCursor = cursor;

  for (let offset = 0; offset < total; offset++) {
    const nextCursor = (currentCursor + direction + total) % total;
    const nextChoice = choices[nextCursor];

    if (nextChoice && !nextChoice.disabled) {
      return nextCursor;
    }

    currentCursor = nextCursor;
  }

  return currentCursor;
};

export const select = async <TValue extends string>(
  options: SelectOptions<TValue>,
  runtime?: PromptRuntime,
) => {
  const promptRuntime = runtime ?? createNodePromptRuntime();

  const initialCursor = (() => {
    if (!options.defaultValue) {
      return findFirstEnabledIndex(options.choices);
    }

    const defaultIndex = options.choices.findIndex(
      (choice) => choice.value === options.defaultValue && !choice.disabled,
    );

    if (defaultIndex >= 0) {
      return defaultIndex;
    }

    return findFirstEnabledIndex(options.choices);
  })();

  return runPromptSession<{ cursor: number }, TValue, SelectOptions<TValue>>({
    runtime: promptRuntime,
    options,
    initialState: {
      cursor: initialCursor,
    },
    render: ({ options: currentOptions, state, errorMessage }) => {
      const lines = [renderQuestionLine(currentOptions.message, "")];

      for (let index = 0; index < currentOptions.choices.length; index++) {
        const choice = currentOptions.choices[index];

        if (!choice) {
          continue;
        }

        const active = state.cursor === index;
        const label = choice.label ?? choice.value;
        const hint = choice.hint ? paint("dim", ` (${choice.hint})`) : "";
        const disabled = choice.disabled ? paint("yellow", " [disabled]") : "";

        lines.push(`${pointer(active)} ${label}${hint}${disabled}`);
      }

      return addErrorLine(lines.join("\n"), errorMessage);
    },
    complete: ({ options: currentOptions, value }) => {
      const selected = currentOptions.choices.find(
        (choice) => choice.value === value,
      );

      return renderSuccessLine(
        currentOptions.message,
        selected?.label ?? value,
      );
    },
    onKey: (state, key) => {
      if (key.name === "up") {
        return {
          cursor: findNextEnabledIndex(options.choices, state.cursor, -1),
        };
      }

      if (key.name === "down") {
        return {
          cursor: findNextEnabledIndex(options.choices, state.cursor, 1),
        };
      }

      return state;
    },
    onSubmit: (state) => {
      const selectedChoice = options.choices[state.cursor];

      if (!selectedChoice) {
        return { errorMessage: "Please select an option" };
      }

      if (selectedChoice.disabled) {
        return { errorMessage: "Selected option is disabled" };
      }

      return { value: selectedChoice.value };
    },
  });
};

export const multiselect = async <TValue extends string>(
  options: MultiselectOptions<TValue>,
  runtime?: PromptRuntime,
) => {
  const promptRuntime = runtime ?? createNodePromptRuntime();

  return runPromptSession<
    { cursor: number; selected: Set<TValue> },
    TValue[],
    MultiselectOptions<TValue>
  >({
    runtime: promptRuntime,
    options,
    initialState: {
      cursor: findFirstEnabledIndex(options.choices),
      selected: new Set<TValue>(options.defaultValue ?? []),
    },
    render: ({ options: currentOptions, state, errorMessage }) => {
      const lines = [renderQuestionLine(currentOptions.message, "")];

      for (let index = 0; index < currentOptions.choices.length; index++) {
        const choice = currentOptions.choices[index];

        if (!choice) {
          continue;
        }

        const active = state.cursor === index;
        const checked = state.selected.has(choice.value) ? "◉" : "◯";
        const disabled = choice.disabled ? paint("yellow", " [disabled]") : "";
        const label = choice.label ?? choice.value;
        const hint = choice.hint ? paint("dim", ` (${choice.hint})`) : "";

        lines.push(`${pointer(active)} ${checked} ${label}${hint}${disabled}`);
      }

      lines.push(
        paint("dim", "  (space to toggle, a to toggle all, enter to submit)"),
      );

      return addErrorLine(lines.join("\n"), errorMessage);
    },
    complete: ({ options: currentOptions, value }) => {
      const labelMap = new Map(
        currentOptions.choices.map((choice) => [choice.value, choice.label]),
      );

      const labels = value.map((v) => labelMap.get(v) ?? v);

      return renderSuccessLine(currentOptions.message, labels.join(", "));
    },
    onKey: (state, key) => {
      if (key.name === "up") {
        return {
          ...state,
          cursor: findNextEnabledIndex(options.choices, state.cursor, -1),
        };
      }

      if (key.name === "down") {
        return {
          ...state,
          cursor: findNextEnabledIndex(options.choices, state.cursor, 1),
        };
      }

      if (key.name === "character") {
        const lowered = (key.value ?? "").toLowerCase();

        if (lowered === "a") {
          const enabledValues = options.choices
            .filter((choice) => !choice.disabled)
            .map((choice) => choice.value);

          const hasEnabledValues = enabledValues.length > 0;

          if (!hasEnabledValues) {
            return state;
          }

          const areAllEnabledSelected = enabledValues.every((value) =>
            state.selected.has(value),
          );

          const nextSelection = new Set(state.selected);

          if (areAllEnabledSelected) {
            for (const value of enabledValues) {
              nextSelection.delete(value);
            }
          } else {
            for (const value of enabledValues) {
              nextSelection.add(value);
            }
          }

          return {
            ...state,
            selected: nextSelection,
          };
        }
      }

      if (key.name !== "space") {
        return state;
      }

      const currentChoice = options.choices[state.cursor];

      if (!currentChoice || currentChoice.disabled) {
        return state;
      }

      const nextSelection = new Set(state.selected);

      if (nextSelection.has(currentChoice.value)) {
        nextSelection.delete(currentChoice.value);
      } else {
        nextSelection.add(currentChoice.value);
      }

      return {
        ...state,
        selected: nextSelection,
      };
    },
    onSubmit: (state) => {
      const values = options.choices
        .filter((choice) => state.selected.has(choice.value))
        .map((choice) => choice.value);

      if (options.min !== undefined && values.length < options.min) {
        return {
          errorMessage: `Please select at least ${options.min} options`,
        };
      }

      if (options.max !== undefined && values.length > options.max) {
        return {
          errorMessage: `Please select at most ${options.max} options`,
        };
      }

      return { value: values };
    },
  });
};

export type { PromptRuntime } from "./core/types.js";
export type {
  ConfirmOptions,
  InputOptions,
  MultiselectOptions,
  NumberOptions,
  PasswordOptions,
  PromptError,
  PromptErrorType,
  SelectChoice,
  SelectOptions,
} from "./types.js";
