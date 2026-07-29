---
title: Prompts
description: Interactive CLI prompts for Bun terminals
---

Ask users questions in the terminal: text, passwords, confirms, numbers, and selects.

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

Needs a real TTY (or a custom `PromptRuntime` for tests).

## Examples

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

Shared options across prompts: `message`, optional `validate`, optional `transform`. Selects take `choices` with `value`, and optional `label`, `hint`, `disabled`.

## Testing

Pass a second argument implementing `PromptRuntime` so prompts do not touch the real terminal:

```typescript
await input({ message: "Name" }, mockRuntime);
```
