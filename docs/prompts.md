# Prompts

Interactive CLI prompts with zero dependencies. Inspired by function-first prompt APIs.

## Import

```typescript
import {
  confirm,
  input,
  multiselect,
  number,
  password,
  select,
} from "semola/prompts";
```

## API

| Function               | Returns    | Use case                                          |
| ---------------------- | ---------- | ------------------------------------------------- |
| `input(options)`       | `string`   | Free-text entry - project names, URLs, file paths |
| `password(options)`    | `string`   | Sensitive input rendered as masked characters     |
| `confirm(options)`     | `boolean`  | Yes/no decisions - deploy, overwrite, continue    |
| `number(options)`      | `number`   | Numeric values - ports, counts, thresholds        |
| `select(options)`      | `TValue`   | Single choice from a list - environments, regions |
| `multiselect(options)` | `TValue[]` | Multiple choices from a list - features, tags     |

All prompt functions return result tuples using `ok/err` pattern:

- success: `[null, value]`
- failure: `[{ type, message }, null]`

## Common options

| Option      | Description                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `message`   | The question text displayed to the user                                                                          |
| `validate`  | Called with the final value before resolving. Return a string to show as an error, or `null`/`undefined` to pass |
| `transform` | Called with the submitted value before resolving. Return the transformed value                                   |

## Prompt-specific options

| Option                          | Prompts                       |
| ------------------------------- | ----------------------------- |
| `defaultValue`                  | all                           |
| `required`                      | `input`, `password`           |
| `requiredMessage`               | `input`, `password`, `number` |
| `placeholder`                   | `input`, `password`           |
| `mask`                          | `password`                    |
| `min` / `max`                   | `number`, `multiselect`       |
| `invalidMessage`                | `number`                      |
| `minMessage` / `maxMessage`     | `number`                      |
| `activeLabel` / `inactiveLabel` | `confirm`                     |
| `choices`                       | `select`, `multiselect`       |

## Examples

### Input

```typescript
const [nameError, name] = await input({
  message: "Project name",
  required: true,
  placeholder: "my-app",
  validate: (value) => (value.length < 2 ? "Too short" : null),
});

if (nameError) {
  console.error(nameError.type, nameError.message);
}
```

### Password

When `mask` is omitted, the cursor stays still while typing and nothing is shown after submit - identical to the Linux `sudo` behavior. When `mask` is set, each character is replaced by the mask symbol and the same number of symbols is shown after submit.

```typescript
// hidden mode - cursor stays still, nothing shown on submit
const [err1, secret] = await password({ message: "Enter password" });

// masked mode - each character shown as "*", same count shown on submit
const [err2, secret2] = await password({
  message: "Enter password",
  mask: "*",
  validate: (value) =>
    value.length < 8 ? "Must be at least 8 characters" : null,
});
```

### Confirm

```typescript
const [confirmError, shouldDeploy] = await confirm({
  message: "Deploy now?",
  defaultValue: true,
});

if (confirmError) {
  console.error(confirmError.type, confirmError.message);
}
```

### Number

```typescript
const [portError, port] = await number({
  message: "Port",
  defaultValue: 3000,
  min: 1,
  max: 65535,
});

if (portError) {
  console.error(portError.type, portError.message);
}
```

### Select

```typescript
const [environmentError, environment] = await select({
  message: "Choose environment",
  choices: [
    { value: "dev", label: "Development" },
    { value: "staging", label: "Staging" },
    { value: "prod", label: "Production", hint: "irreversible" },
  ],
});

if (environmentError) {
  console.error(environmentError.type, environmentError.message);
}
```

### Multiselect

```typescript
const [toolsError, tools] = await multiselect({
  message: "Enable tools",
  choices: [{ value: "lint" }, { value: "test" }, { value: "build" }],
  min: 1,
});

if (toolsError) {
  console.error(toolsError.type, toolsError.message);
}
```

### Transform

```typescript
const [portError, port] = await number({
  message: "Port",
  defaultValue: 3000,
  transform: (value) => Math.floor(value),
});
```

### Async validate

```typescript
const [nameError, name] = await input({
  message: "Username",
  validate: async (value) => {
    const taken = await checkUsernameExists(value);
    return taken ? "Username already taken" : null;
  },
});
```

## Types

### `BasePromptOptions<TValue>`

| Property    | Type                | Description                                                                                                      |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `message`   | `string`            | The question text displayed to the user                                                                          |
| `validate`  | `Validate<TValue>`  | Called with the final value before resolving. Return a string to show as an error, or `null`/`undefined` to pass |
| `transform` | `Transform<TValue>` | Called with the submitted value before resolving. Return the transformed value                                   |

### `InputOptions`

Includes all properties from `BasePromptOptions<string>`.

| Property          | Type      | Description                                 |
| ----------------- | --------- | ------------------------------------------- |
| `defaultValue`    | `string`  | Pre-filled value shown in the input         |
| `placeholder`     | `string`  | Ghost text shown when the input is empty    |
| `required`        | `boolean` | Prevents submission when the input is empty |
| `requiredMessage` | `string`  | Error message shown when required and empty |

### `PasswordOptions`

Includes all properties from `InputOptions`.

| Property | Type     | Description                                                                                  |
| -------- | -------- | -------------------------------------------------------------------------------------------- |
| `mask`   | `string` | Character used to replace each typed character. When omitted, nothing is shown (hidden mode) |

### `ConfirmOptions`

Includes all properties from `BasePromptOptions<boolean>`.

| Property        | Type      | Description                                      |
| --------------- | --------- | ------------------------------------------------ |
| `defaultValue`  | `boolean` | Pre-selected answer                              |
| `activeLabel`   | `string`  | Label for the "yes" option (defaults to `"Yes"`) |
| `inactiveLabel` | `string`  | Label for the "no" option (defaults to `"No"`)   |

### `NumberOptions`

Includes all properties from `BasePromptOptions<number>`.

| Property          | Type     | Description                                      |
| ----------------- | -------- | ------------------------------------------------ |
| `defaultValue`    | `number` | Pre-filled numeric value                         |
| `min`             | `number` | Minimum allowed value                            |
| `max`             | `number` | Maximum allowed value                            |
| `requiredMessage` | `string` | Error shown when no value is entered             |
| `invalidMessage`  | `string` | Error shown when the value is not a valid number |
| `minMessage`      | `string` | Error shown when the value is below `min`        |
| `maxMessage`      | `string` | Error shown when the value is above `max`        |

### `SelectOptions<TValue>`

Includes all properties from `BasePromptOptions<TValue>`.

| Property       | Type                     | Description                                       |
| -------------- | ------------------------ | ------------------------------------------------- |
| `choices`      | `SelectChoice<TValue>[]` | Non-empty list of options                         |
| `defaultValue` | `TValue`                 | Value of the choice the arrow initially points to |

### `MultiselectOptions<TValue>`

Includes all properties from `BasePromptOptions<TValue[]>`.

| Property       | Type                     | Description                                     |
| -------------- | ------------------------ | ----------------------------------------------- |
| `choices`      | `SelectChoice<TValue>[]` | Non-empty list of options                       |
| `defaultValue` | `readonly TValue[]`      | Values pre-selected when the prompt opens       |
| `min`          | `number`                 | Minimum number of choices that must be selected |
| `max`          | `number`                 | Maximum number of choices that can be selected  |

### `SelectChoice<TValue>`

| Property   | Type      | Description                              |
| ---------- | --------- | ---------------------------------------- |
| `value`    | `TValue`  | Returned when selected                   |
| `label`    | `string`  | Display text (defaults to `value`)       |
| `hint`     | `string`  | Secondary text shown alongside the label |
| `disabled` | `boolean` | Prevents the choice from being selected  |

### `PromptRuntime`

Used to provide a custom I/O backend (e.g. for testing).

| Method               | Description                                   |
| -------------------- | --------------------------------------------- |
| `isInteractive()`    | Returns `true` if running in interactive mode |
| `init()`             | Initialize the runtime                        |
| `readKey()`          | Read the next key press                       |
| `render(frame)`      | Display a frame during interaction            |
| `done(frame)`        | Display the final frame and clean up          |
| `close()`            | Close the runtime                             |
| `interrupt(message)` | _(optional)_ Interrupt with a message         |

```typescript
import { input } from "semola/prompts";
import type { PromptRuntime } from "semola/prompts";

const runtime: PromptRuntime = { ... };

const [error, value] = await input({ message: "Name" }, runtime);
```

## Interactive-only behavior

Prompts require a TTY with raw mode support.

If interactive mode is unavailable, prompt functions return:

```typescript
[
  {
    type: "PromptEnvironmentError",
    message: "Interactive prompts require a TTY with raw mode support",
  },
  null,
];
```
