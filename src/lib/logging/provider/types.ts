import type { LogLevelType } from "../core/types.js";
import type { Formatter } from "../formatter/index.js";

export type ProviderOptions = {
  level?: LogLevelType;
  formatter?: Formatter;
};

export interface SizeBasedPolicyType {
  type: "size";
  maxSize?: number;
}

export interface TimeBasedPolicyType {
  type: "time";
  instant: "hour" | "day" | "week" | "month";
  duration: number;
}

export type FileProviderOptions = ProviderOptions & {
  policy?: SizeBasedPolicyType | TimeBasedPolicyType;
};
