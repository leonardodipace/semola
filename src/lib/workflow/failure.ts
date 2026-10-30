import { mightThrowSync } from "../errors/index.js";
import {
  NonRetryableStepError,
  SerializationError,
  UnregisteredWorkflowError,
} from "./errors.js";
import type {
  PersistedFailure,
  UnregisteredErrorsMode,
  WorkflowErrorConstructor,
} from "./types.js";

export const toError = (value: unknown) => {
  if (value instanceof Error) return value;

  if (typeof value === "string") return new Error(value);

  return new Error("non-Error value thrown");
};

export const toPersistedFailure = (error: Error): PersistedFailure => ({
  message: error.message,
  name: error.constructor.name || error.name || "Error",
});

const BUILTIN_ERROR_CTORS: WorkflowErrorConstructor[] = [
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  URIError,
  EvalError,
];

export const createErrorRegistry = (
  errors: WorkflowErrorConstructor[] = [],
) => {
  const byName = new Map<string, WorkflowErrorConstructor>();

  for (const Ctor of [
    ...BUILTIN_ERROR_CTORS,
    NonRetryableStepError,
    SerializationError,
    UnregisteredWorkflowError,
    ...errors,
  ]) {
    if (!Ctor.name) continue;

    byName.set(Ctor.name, Ctor);
  }

  return byName;
};

const isKnownFailureName = (
  name: string,
  registry: Map<string, WorkflowErrorConstructor>,
) => {
  if (name === "Error") return true;
  if (name === "AggregateError") return true;
  if (registry.has(name)) return true;

  return false;
};

const unregisteredMessage = (name: string) =>
  `Workflow error class "${name}" is not listed in defineWorkflow({ errors })`;

const warnUnregistered = (name: string, warned: Set<string>) => {
  if (warned.has(name)) return;

  warned.add(name);
  console.warn(`[semola/workflow] ${unregisteredMessage(name)}`);
};

export const resolveUnregisteredError = (
  error: Error,
  registry: Map<string, WorkflowErrorConstructor>,
  mode: UnregisteredErrorsMode,
  warned: Set<string>,
) => {
  const name = error.constructor.name || error.name || "Error";

  if (isKnownFailureName(name, registry)) return error;

  if (mode === "error") {
    return new UnregisteredWorkflowError(unregisteredMessage(name));
  }

  warnUnregistered(name, warned);
  return error;
};

export const reviveFailure = (
  failure: PersistedFailure,
  registry: Map<string, WorkflowErrorConstructor>,
  mode: UnregisteredErrorsMode,
  warned: Set<string>,
) => {
  const { message, name } = failure;
  const Ctor = registry.get(name);

  if (Ctor) {
    const [error, revived] = mightThrowSync(() => new Ctor(message));

    if (!error) {
      if (revived instanceof Error) {
        if (revived.name === "Error") {
          if (name !== "Error") {
            revived.name = name;
          }
        }

        return revived;
      }
    }
  }

  if (!isKnownFailureName(name, registry)) {
    if (mode === "error") {
      return new UnregisteredWorkflowError(unregisteredMessage(name));
    }

    warnUnregistered(name, warned);
  }

  const fallback = new Error(message);
  fallback.name = name;
  return fallback;
};
