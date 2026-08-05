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

Selects take `choices` with `value`, and optional `label`, `hint`, `disabled`. Multiselect: space toggles, `a` selects all enabled.

### Defaults

| Prompt | Notable defaults |
| --- | --- |
| `confirm` | `defaultValue: false`; Yes/No labels |
| `password` | Omit `mask` to hide text entirely |
| `number` | Always requires a finite value |
| `multiselect` | `defaultValue: []` |

## Examples

### Example: Full setup flow

```typescript
const name = await input({
  message: "Project name",
  placeholder: "my-app",
  required: true,
});

const secret = await password({
  message: "API token",
  mask: "*",
});

const proceed = await confirm({
  message: "Create the project?",
  defaultValue: true,
});

const port = await number({
  message: "Port",
  min: 1,
  max: 65535,
  defaultValue: 3000,
});

const framework = await select({
  message: "Framework",
  choices: [
    { value: "bun", label: "Bun" },
    { value: "node", label: "Node", hint: "legacy" },
  ],
});

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

### Example: Validation

```typescript
const email = await input({
  message: "Email",
  validate: (value) =>
    value.includes("@") ? undefined : "Enter a valid email",
});
```

### Example: Testing with a mock runtime

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

Pass `runtime` on options or as the second argument for non-TTY / tests.
