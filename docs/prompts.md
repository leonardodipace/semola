---
title: Prompts
description: Interactive CLI prompts for Bun terminals
---

Ask users questions in the terminal: text, passwords, confirms, numbers, and selects.

Needs a real TTY (or a custom `PromptRuntime` for tests). Ctrl+C cancels.

## Import

```typescript
import {
  input,
  password,
  confirm,
  number,
  select,
  multiselect,
} from "semola/prompts";
```

## Quick start

The first prompt requires a project name; the second returns a boolean, defaulting to `true` when the user presses Enter.

```typescript
const name = await input({
  message: "Project name",
  placeholder: "my-app",
  required: true,
});

const proceed = await confirm({
  message: "Create the project?",
  defaultValue: true,
});
```

## Prompt kinds

Shared options across prompts: `message`, optional `validate`, optional `transform`. Pass a second argument implementing `PromptRuntime` so prompts do not touch the real terminal.

Selects take `choices` with `value`, and optional `label`, `hint`, `disabled`. Multiselect: space toggles, `a` toggles all enabled (second press clears them).

### Defaults

| Prompt | Notable defaults |
| --- | --- |
| `confirm` | `defaultValue: false`; Yes/No labels |
| `password` | Omit `mask` to hide text entirely |
| `number` | Always requires a finite value |
| `multiselect` | `defaultValue: []` |

## Examples

### Text input with `input()`

`input()` reads a line of text and enforces the required value before returning.

```typescript
const name = await input({
  message: "Project name",
  placeholder: "my-app",
  required: true,
});
```

### Hidden input with `password()`

`password()` masks each typed character and returns the secret text.

```typescript
const secret = await password({
  message: "API token",
  mask: "*",
});
```

### Boolean input with `confirm()`

`confirm()` asks a yes-or-no question and uses `true` when the user accepts the default.

```typescript
const proceed = await confirm({
  message: "Create the project?",
  defaultValue: true,
});
```

### Numeric input with `number()`

`number()` rejects non-finite values and enforces the configured range.

```typescript
const port = await number({
  message: "Port",
  min: 1,
  max: 65535,
  defaultValue: 3000,
});
```

### One choice with `select()`

`select()` returns the selected choice's typed `value`; labels and hints only affect display.

```typescript
const framework = await select({
  message: "Framework",
  choices: [
    { value: "bun", label: "Bun" },
    { value: "node", label: "Node", hint: "legacy" },
  ],
});
```

### Many choices with `multiselect()`

`multiselect()` returns selected values and keeps prompting until at least one is selected.

```typescript
const features = await multiselect({
  message: "Features",
  choices: [
    { value: "auth" },
    { value: "queue" },
    { value: "orm" },
  ],
  min: 1,
});
```

### Validate input

Returning an error string keeps the prompt open; returning `undefined` accepts the value.

```typescript
const email = await input({
  message: "Email",
  validate: (value) =>
    value.includes("@") ? undefined : "Enter a valid email",
});
```

### Test with a mock runtime

Passing a runtime as the second argument keeps the prompt away from the real terminal.

```typescript
await input({ message: "Name" }, mockRuntime);
```

## Reference

| Export | Meaning |
| --- | --- |
| `input` | Text |
| `password` | Secret text |
| `confirm` | Yes / No |
| `number` | Numeric input |
| `select` | Single choice |
| `multiselect` | Multiple choices |

Pass `runtime` as the second argument for non-TTY use or tests.
