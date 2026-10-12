export type QueueKeySuffix = "jobs" | "inflight" | "retry" | "dead-letter";

export const queueKey = (name: string, suffix: QueueKeySuffix) =>
  `queue:${name}:${suffix}`;
