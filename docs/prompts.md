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

All prompt functions return the selected value directly.

- `input(options)`
- `password(options)`
- `confirm(options)`
- `number(options)`
- `select(options)`
- `multiselect(options)`

### Common options

- `message: string`
- `validate?: (value) => string | null | undefined | Promise<...>`
- `transform?: (value) => value | Promise<...>`

## Examples

### Input

```typescript
const name = await input({
  message: "Project name",
  required: true,
  validate: (value) => (value.length < 2 ? "Too short" : null),
});
```

### Confirm

```typescript
const shouldDeploy = await confirm({
  message: "Deploy now?",
  defaultValue: true,
});
```

### Select

```typescript
const environment = await select({
  message: "Choose environment",
  choices: [
    { value: "dev", label: "Development" },
    { value: "staging", label: "Staging" },
    { value: "prod", label: "Production" },
  ],
});
```

### Multiselect

```typescript
const tools = await multiselect({
  message: "Enable tools",
  choices: [{ value: "lint" }, { value: "test" }, { value: "build" }],
  min: 1,
});
```

## Interactive-only behavior

Prompts require a TTY with raw mode support.

If interactive mode is unavailable, prompt functions throw a `PromptError`:

```typescript
try {
  await input({ message: "Project name" });
} catch (error) {
  if (error instanceof PromptError) {
    console.error(error.type, error.message);
  }
}
```
