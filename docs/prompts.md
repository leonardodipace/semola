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
| `placeholder`                   | `input`                       |
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

```typescript
const [passwordError, password] = await password({
  message: "Enter password",
  required: true,
  mask: "*",
  validate: (value) =>
    value.length < 8 ? "Must be at least 8 characters" : null,
});

if (passwordError) {
  console.error(passwordError.type, passwordError.message);
}
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
