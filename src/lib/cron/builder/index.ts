import type { CronAny, CronJobBuilderOptions, CronList } from "./types.js";

export function cronJobBuilder(options: CronJobBuilderOptions) {}

export function range<Min, Max>(options: { min: Min; max: Max }) {
  return options;
}

export function step<Step, Min, Max>(options: {
  step: Step;
  min?: Min;
  max?: Max;
}) {
  return options;
}

export function list<E>(...elements: CronList<E>) {
  return elements;
}

export function any(): CronAny {
  return { wildcard: "*" };
}
