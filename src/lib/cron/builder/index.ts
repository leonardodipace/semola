import type { CronJobBuilderOptions, CronList } from "./types.js";

export function cronJobBuilder(options: CronJobBuilderOptions) {}

export function range<Min, Max>(min: Min, max: Max) {
  return { min, max };
}

export function step<Step, Min, Max>(options: {
  step: Step;
  range: { min: Min; max: Max };
}) {
  return options;
}

export function list<E>(elements: CronList<E>) {
  return elements;
}
