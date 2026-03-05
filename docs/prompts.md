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
const [nameError, name] = await input({
  message: "Project name",
  required: true,
  validate: (value) => (value.length < 2 ? "Too short" : null),
});

if (nameError) {
  console.error(nameError.type, nameError.message);
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

### Select

```typescript
const [environmentError, environment] = await select({
  message: "Choose environment",
  choices: [
    { value: "dev", label: "Development" },
    { value: "staging", label: "Staging" },
    { value: "prod", label: "Production" },
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
