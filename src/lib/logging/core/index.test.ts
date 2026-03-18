import { beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { basename, dirname, join } from "node:path";
import { mightThrowSync } from "../../errors/index.js";
import {
  BaseFormatter,
  dmyFormat,
  Formatter,
  isoDateFormat,
  JSONFormatter,
  mdyFormat,
} from "./formatter.js";
import { LoggerProvider } from "./index.js";
import {
  type FileProviderOptions,
  type LogDataType,
  LogLevel,
  type LogLevelType,
  type SizeBasedPolicyType,
  type TimeBasedPolicyType,
} from "./types.js";

beforeAll(() => {
  setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
});

type MockProviderResult = {
  msg: string;
  level: 10 | 20 | 30 | 40 | 50 | -1;
};

const logTypes: LogLevelType[] = [
  "debug",
  "info",
  "warning",
  "error",
  "critical",
];

function baseErrorFormat(error: Error) {
  let errorMsg = `Error name="${error.name}" Error message="${error.message}"`;

  if (error.cause) {
    errorMsg = `${errorMsg} Error cause="${error.cause}"`;
  }

  if (error.stack) {
    errorMsg = `${errorMsg} Stack trace="${error.stack}"`;
  }

  return errorMsg;
}

function jsonErrorFormat(error: Error) {
  let errorMsg: Record<string, unknown> = {
    errorName: error.name,
    errorMessage: error.message,
  };

  if (error.cause) {
    errorMsg = { ...errorMsg, errorCause: error.cause };
  }

  if (error.stack) {
    errorMsg = { ...errorMsg, stackTrace: error.stack };
  }

  return JSON.stringify(errorMsg);
}

const DurationUnit = {
  hour: 1000 * 60 * 60,
  day: 1000 * 60 * 60 * 24,
  week: 1000 * 60 * 60 * 24 * 7,
  month: 1000 * 60 * 60 * 24 * 7 * 4.345, // On average 1 month has 4,345 weeks
} as const;

class MockFormatter extends Formatter {
  public format(logData: LogDataType): string {
    if (typeof logData.msg === "object") {
      return JSON.stringify(logData);
    }

    return `${logData.msg}`;
  }
  public formatError(_logData: LogDataType, error: Error): string {
    return `${error.name} => ${error.message}`;
  }
}

class MockConsoleProvider extends LoggerProvider {
  public execute(data: LogDataType): MockProviderResult {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return { msg: "", level: -1 };

    const [error, formattedMessage] = mightThrowSync(() => {
      const { formatter } = this.options;
      return formatter?.format(data) ?? "";
    });

    if (error && error instanceof Error) {
      const { formatter } = this.options;
      const errorMsg = formatter?.formatError(data, error) ?? "";
      return { msg: errorMsg, level: -1 };
    }

    if (!formattedMessage) return { msg: "", level: -1 };

    switch (userLevel) {
      case LogLevel.debug:
        return { msg: formattedMessage, level: userLevel };
      case LogLevel.info:
        return { msg: formattedMessage, level: userLevel };
      case LogLevel.warning:
        return { msg: formattedMessage, level: userLevel };
      case LogLevel.error:
        return { msg: formattedMessage, level: userLevel };
      case LogLevel.critical:
        return { msg: formattedMessage, level: userLevel };
      default:
        return { msg: formattedMessage, level: LogLevel.debug };
    }
  }
}

class MockFileProvider extends LoggerProvider {
  private readonly filePath: string;

  private counter: number;
  private file: string;
  private policy?: SizeBasedPolicyType | TimeBasedPolicyType;

  public fs: {
    [key: string]: { content: string; birthtime: Date; isJSON: boolean };
  } = {};

  public constructor(file: string, options: FileProviderOptions) {
    super({ formatter: options.formatter, level: options.level });
    this.policy = options.policy;

    this.filePath = file;
    this.counter = 0;
    this.file = this.createNewFileName();
    this.fs[this.file] = {
      content: "",
      birthtime: new Date(),
      isJSON: file.endsWith(".json"),
    };
  }

  public execute(data: LogDataType): MockProviderResult {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return { msg: "", level: -1 };

    const [error, formattedMessage] = mightThrowSync(() => {
      if (this.isJSONFile()) {
        return JSON.stringify({ message: data.msg });
      }

      const { formatter } = this.options;
      return formatter?.format(data) ?? "";
    });

    if (error && error instanceof Error) {
      const { formatter } = this.options;
      const errorMsg = formatter?.formatError(data, error);

      const newContent =
        this.fs[this.file]?.content?.concat(`${errorMsg}\n`) ?? "";

      this.fs[this.file] = {
        content: newContent,
        birthtime: this.fs[this.file]?.birthtime ?? new Date(),
        isJSON: this.fs[this.file]?.isJSON ?? false,
      };
    }

    if (this.canRollFile()) {
      this.counter += 1;
      this.file = this.createNewFileName();
      this.fs[this.file] = {
        content: "",
        birthtime: new Date(),
        isJSON: this.file.endsWith(".json"),
      };
    }

    if (error || !formattedMessage) {
      return { msg: this.fs[this.file]?.content ?? "", level: -1 };
    }
    const newContent =
      this.fs[this.file]?.content?.concat(`${formattedMessage}\n`) ?? "";

    this.fs[this.file] = {
      content: newContent,
      birthtime: this.fs[this.file]?.birthtime ?? new Date(),
      isJSON: this.fs[this.file]?.isJSON ?? false,
    };

    return { msg: this.fs[this.file]?.content ?? "", level: userLevel };
  }

  private canRollFile() {
    if (!this.policy) return false;

    switch (this.policy.type) {
      case "size": {
        if (this.policy.maxSize) {
          return this.getFileSize() >= this.policy.maxSize;
        }

        return this.getFileSize() >= 10;
      }
      case "time": {
        if (!this.fs[this.file]) return false;

        const { duration, instant } = this.policy;
        const creationTimeMs =
          this.fs[this.file]?.birthtime.getTime() ?? Date.now();
        const currenTimeMs = Date.now();
        const diffMs = currenTimeMs - creationTimeMs;

        switch (instant) {
          case "hour":
            return Math.floor(diffMs / DurationUnit.hour) >= duration;
          case "day":
            return Math.floor(diffMs / DurationUnit.day) >= duration;
          case "week":
            return Math.floor(diffMs / DurationUnit.week) >= duration;
          case "month":
            return Math.floor(diffMs / DurationUnit.month) >= duration;
        }
      }
    }
  }

  private getFileSize() {
    return this.fs[this.file]?.content.length ?? 0;
  }

  private isJSONFile() {
    return this.fs[this.file]?.isJSON ?? false;
  }

  private createNewFileName() {
    const fileName = basename(this.filePath);
    const directory = dirname(this.filePath);
    const fileInfo = fileName.split(".");
    const extension = fileInfo.pop();
    const newFileName = [...fileInfo, this.counter, extension].join(".");

    return join(directory, newFileName);
  }
}

function createConsoleMockProvider(level: LogLevelType = "debug") {
  return new MockConsoleProvider({
    level: level,
    formatter: new MockFormatter(isoDateFormat),
  });
}

function createFileMockProvider(
  file: string,
  level: LogLevelType = "debug",
  policy: TimeBasedPolicyType | SizeBasedPolicyType = { type: "size" },
) {
  return new MockFileProvider(file, {
    level: level,
    formatter: new MockFormatter(isoDateFormat),
    policy,
  });
}

describe("Logging", () => {
  describe("Providers", () => {
    describe("Console provider class", () => {
      test.each([
        { level: "debug", expected: 10 },
        { level: "info", expected: 20 },
        { level: "warning", expected: 30 },
        { level: "error", expected: 40 },
        { level: "critical", expected: 50 },
      ])("Should return a '$level' message", (data) => {
        const mockProvider = createConsoleMockProvider();
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(data.expected);
        expect(result.msg).not.toBeEmpty();
      });

      test.each([
        { level: "debug" },
        { level: "info" },
        { level: "warning" },
        { level: "error" },
        { level: "critical" },
      ])("'debug' level should show all logs of level '$level'", (data) => {
        const mockProvider = createConsoleMockProvider();
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toBeGreaterThan(-1);
        expect(result.msg).not.toBeEmpty();
      });

      test.each([
        { level: "info" },
        { level: "warning" },
        { level: "error" },
        { level: "critical" },
      ])("'debug' level should be ignored when log level is set to '$level'", (data) => {
        const mockProvider = createConsoleMockProvider(data.level);

        const logData: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test.each([
        { level: "warning" },
        { level: "error" },
        { level: "critical" },
      ])("'debug' and 'info' levels should be ignored when log level is set to '$level'", (data) => {
        const mockProvider = createConsoleMockProvider(data.level);
        const logData: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "mock",
        };

        let result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();

        logData.level = "info";
        result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test.each([
        { level: "error" },
        { level: "critical" },
      ])("'debug', 'info' and 'warning' levels should be ignored when log level is set to '$level'", (data) => {
        const mockProvider = createConsoleMockProvider(data.level);
        const logData: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "mock",
        };

        let result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();

        logData.level = "info";
        result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();

        logData.level = "warning";
        result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test.each([
        { level: "debug" },
        { level: "info" },
        { level: "warning" },
        { level: "error" },
      ])("Should show only 'critical' level logs when passed data created with '$level' level", (data) => {
        const mockProvider = createConsoleMockProvider("critical");
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test("Should return an error message", () => {
        const mockProvider = createConsoleMockProvider();
        const logData: LogDataType = {
          level: "debug",
          msg: {},
          prefix: "mock",
        };

        logData.msg = logData;

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).not.toBeEmpty();
      });
    });

    describe("File provider class", () => {
      test.each([
        { level: "debug", expected: 10 },
        { level: "info", expected: 20 },
        { level: "warning", expected: 30 },
        { level: "error", expected: 40 },
        { level: "critical", expected: 50 },
      ])("Should return a '$level' message", (data) => {
        const mockProvider = createFileMockProvider("file.log");
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(data.expected);
        expect(result.msg).not.toBeEmpty();
        expect(result.msg).toEqualIgnoringWhitespace("A message");
      });

      test.each([
        { level: "debug", expected: 10 },
        { level: "info", expected: 20 },
        { level: "warning", expected: 30 },
        { level: "error", expected: 40 },
        { level: "critical", expected: 50 },
      ])("Should return a '$level' message for a JSON file", (data) => {
        const mockProvider = createFileMockProvider("file.json");
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(data.expected);
        expect(result.msg).not.toBeEmpty();
        expect(result.msg).toEqualIgnoringWhitespace(
          JSON.stringify({ message: "A message" }),
        );
      });

      test.each([
        { level: "debug" },
        { level: "info" },
        { level: "warning" },
        { level: "error" },
        { level: "critical" },
      ])("'debug' level should show all logs of level '$level'", (data) => {
        const mockProvider = createFileMockProvider("file.log");
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toBeGreaterThan(-1);
        expect(result.msg).not.toBeEmpty();
        expect(result.msg).toEqualIgnoringWhitespace("A message");
      });

      test.each([
        { level: "info" },
        { level: "warning" },
        { level: "error" },
        { level: "critical" },
      ])("'debug' level should be ignored when log level is set to '$level'", (data) => {
        const mockProvider = createFileMockProvider("file.log", data.level);

        const logData: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test.each([
        { level: "warning" },
        { level: "error" },
        { level: "critical" },
      ])("'debug' and 'info' levels should be ignored when log level is set to '$level'", (data) => {
        const mockProvider = createFileMockProvider("file.log", data.level);
        const logData: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "mock",
        };

        let result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();

        logData.level = "info";
        result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test.each([
        { level: "error" },
        { level: "critical" },
      ])("'debug', 'info' and 'warning' levels should be ignored when log level is set to '$level'", (data) => {
        const mockProvider = createFileMockProvider("file.log", data.level);
        const logData: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "mock",
        };

        let result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();

        logData.level = "info";
        result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();

        logData.level = "warning";
        result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test.each([
        { level: "debug" },
        { level: "info" },
        { level: "warning" },
        { level: "error" },
      ])("Should show only 'critical' level logs when passed data created with '$level' level", (data) => {
        const mockProvider = createFileMockProvider("file.log", "critical");
        const logData: LogDataType = {
          level: data.level,
          msg: "A message",
          prefix: "mock",
        };

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).toBeEmpty();
      });

      test("Should return an error message", () => {
        const mockProvider = createFileMockProvider("file.log", "debug", {
          type: "size",
          maxSize: 4 * 1024,
        });
        const logData: LogDataType = {
          level: "debug",
          msg: {},
          prefix: "mock",
        };

        logData.msg = logData;

        const result = mockProvider.execute(logData);
        expect(result.level).toEqual(-1);
        expect(result.msg).not.toBeEmpty();
      });

      describe("Size based rolling", () => {
        test("Should save all rows", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "size",
            maxSize: 400,
          });

          const firstRow: LogDataType = {
            level: "debug",
            msg: "First message",
            prefix: "mock",
          };
          mockProvider.execute(firstRow);

          const secondRow: LogDataType = {
            level: "debug",
            msg: "Second message",
            prefix: "mock",
          };
          mockProvider.execute(secondRow);

          const file = mockProvider.fs["file.0.log"];
          expect(file).not.toBeFalsy();
          expect(file).toBeObject();
          expect(file?.isJSON).toBeFalse();
          expect(file?.content).not.toBeEmpty();
          expect(file?.content).toEqualIgnoringWhitespace(
            `${firstRow.msg}`.concat(`${secondRow.msg}`),
          );
        });

        test("Should create a new file because it reached its max size", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "size",
            maxSize: 20,
          });

          const longData: LogDataType = {
            level: "debug",
            msg: "This is a very long log message",
            prefix: "mock",
          };
          mockProvider.execute(longData);

          const firstRow: LogDataType = {
            level: "debug",
            msg: "One",
            prefix: "mock",
          };
          mockProvider.execute(firstRow);

          const secondRow: LogDataType = {
            level: "debug",
            msg: "Two",
            prefix: "mock",
          };
          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            "This is a very long log message",
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `${firstRow.msg}`.concat(`${secondRow.msg}`),
          );
        });
      });

      describe("Time based rolling", () => {
        test("Should create a new file after 3 hours", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 3,
            instant: "hour",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-01-10T03:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 30 hours", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 30,
            instant: "hour",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-01-11T06:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 1 week", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 1,
            instant: "week",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-01-17T00:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 5 week", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 5,
            instant: "week",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-02-17T00:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 4 days", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 4,
            instant: "day",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-01-14T00:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 60 days", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 60,
            instant: "day",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-03-10T00:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 1 month", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 1,
            instant: "month",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2020-02-10T00:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });

        test("Should create a new file after 24 months", () => {
          const mockProvider = createFileMockProvider("file.log", "debug", {
            type: "time",
            duration: 24,
            instant: "month",
          });
          const firstCreatedAt = new Date().toISOString();
          const firstRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${firstCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(firstRow);
          setSystemTime(new Date("2022-01-10T00:00:00.000Z"));

          const secondCreatedAt = new Date().toISOString();
          const secondRow: LogDataType = {
            level: "debug",
            msg: `File created at: ${secondCreatedAt}`,
            prefix: "mock",
          };

          mockProvider.execute(secondRow);

          const firstFile = mockProvider.fs["file.0.log"];
          expect(firstFile).not.toBeFalsy();
          expect(firstFile).toBeObject();
          expect(firstFile?.isJSON).toBeFalse();
          expect(firstFile?.birthtime.toISOString()).toEqual(firstCreatedAt);
          expect(firstFile?.content).not.toBeEmpty();
          expect(firstFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${firstCreatedAt}`,
          );

          const secondFile = mockProvider.fs["file.1.log"];
          expect(secondFile).not.toBeFalsy();
          expect(secondFile).toBeObject();
          expect(secondFile?.isJSON).toBeFalse();
          expect(secondFile?.birthtime.toISOString()).toEqual(secondCreatedAt);
          expect(secondFile?.content).not.toBeEmpty();
          expect(secondFile?.content).toEqualIgnoringWhitespace(
            `File created at: ${secondCreatedAt}`,
          );

          setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
        });
      });
    });
  });

  describe("Formatters", () => {
    describe("Base formatter class", () => {
      test.each(logTypes)("should format a '%s' message", (t) => {
        const expected = `2020-01-10T00:00:00.000Z  [${t.toUpperCase()}] [/api/index.ts:1:10] : A message`;

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: t,
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message containing a simple object", () => {
        const expected =
          '2020-01-10T00:00:00.000Z  [DEBUG] [/api/index.ts:1:10] : {"msg": "A message"}';

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: { msg: "A message" },
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message containing a number", () => {
        const expected =
          "2020-01-10T00:00:00.000Z  [DEBUG] [/api/index.ts:1:10] : 42";

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: 42,
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message containing a boolean", () => {
        const expected =
          "2020-01-10T00:00:00.000Z  [DEBUG] [/api/index.ts:1:10] : true";

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: true,
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message containing an array", () => {
        const expected =
          "2020-01-10T00:00:00.000Z  [DEBUG] [/api/index.ts:1:10] : [1,2,3]";

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: [1, 2, 3],
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message containing a complex object", () => {
        const object = {
          title: "Ready To Fly",
          status: "published",
          reviews: [
            {
              userId: 10,
              comment: "First comment",
              isAdmin: false,
            },
            {
              userId: 20,
              comment: "Second comment",
              isAdmin: true,
            },
          ],
        };
        const strObj = JSON.stringify(object);
        const expected = `2020-01-10T00:00:00.000Z  [DEBUG] [/api/index.ts:1:10] : ${strObj}`;
        const formatter = new BaseFormatter();

        const data: LogDataType = {
          level: "debug",
          msg: object,
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message with YYYY-MM-DD timestamp format", () => {
        const expected = "2020-01-10  [DEBUG] [/api/index.ts:1:10] : A message";

        const formatter = new BaseFormatter(isoDateFormat);
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message with DD-MM-YYYY timestamp format", () => {
        const expected = "10-01-2020  [DEBUG] [/api/index.ts:1:10] : A message";

        const formatter = new BaseFormatter(dmyFormat);
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message with MM-DD-YYYY timestamp format", () => {
        const expected = "01-10-2020  [DEBUG] [/api/index.ts:1:10] : A message";

        const formatter = new BaseFormatter(mdyFormat);
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format an error message", () => {
        const error = new Error("Formatting error");
        const errorData = baseErrorFormat(error);
        const expected = `2020-01-10T00:00:00.000Z  [ERROR] [/api/index.ts:1:10] : ${errorData}`;

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.formatError(data, error);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format an error message containing the error's 'cause'", () => {
        const error = new Error("Formatting error", {
          cause: new Error("Root error"),
        });
        const errorData = baseErrorFormat(error);
        const expected = `2020-01-10T00:00:00.000Z  [ERROR] [/api/index.ts:1:10] : ${errorData}`;

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.formatError(data, error);
        expect(expected).toEqualIgnoringWhitespace(res);
      });

      test("should format a debug message with a method or function name", () => {
        const expected =
          "2020-01-10T00:00:00.000Z  [DEBUG] [foo] [/api/index.ts:1:10] : A message";

        const formatter = new BaseFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          method: "foo",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
      });
    });

    describe("JSON formatter class", () => {
      test.each(logTypes)("should format a '%s' message as JSON", (t) => {
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"${t.toUpperCase()}"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": "A message"}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: t,
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message containing a number", () => {
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg":1}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: 1,
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message containing a boolean", () => {
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg":true}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: true,
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message containing an array", () => {
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg":[1,2,3]}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: [1, 2, 3],
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message containing a simple object", () => {
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": {"msg": "A message"}}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: { msg: "A message" },
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message containing a complex object", () => {
        const object = {
          title: "Ready To Fly",
          status: "published",
          reviews: [
            {
              userId: 10,
              comment: "First comment",
              isAdmin: false,
            },
            {
              userId: 20,
              comment: "Second comment",
              isAdmin: true,
            },
          ],
        };
        const strObj = JSON.stringify(object);
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": ${strObj}}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: object,
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message with YYYY-MM-DD timestamp format", () => {
        const header = `"timestamp":"2020-01-10", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": "A message"}`;

        const formatter = new JSONFormatter(isoDateFormat);
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message with DD-MM-YYYY timestamp format", () => {
        const header = `"timestamp":"10-01-2020", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": "A message"}`;

        const formatter = new JSONFormatter(dmyFormat);
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message with MM-DD-YYYY timestamp format", () => {
        const header = `"timestamp":"01-10-2020", "level":"DEBUG"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": "A message"}`;

        const formatter = new JSONFormatter(mdyFormat);
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).not.toHaveProperty("position.method");
      });

      test("should format a debug JSON message with a method or function name", () => {
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"DEBUG"`;
        const position = `"position":{"method":"foo","fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": {"msg": "A message"}}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: { msg: "A message" },
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
          method: "foo",
        };

        const res = formatter.format(data);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        expect(JSON.parse(res)).toHaveProperty("position.method");
      });

      test("should format an error message as JSON", () => {
        const error = new Error("Formatting error");
        const errorData = jsonErrorFormat(error);
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"ERROR"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": ${errorData}}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.formatError(data, error);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        const parsedJSON = JSON.parse(res);
        expect(parsedJSON).not.toHaveProperty("position.method");
        expect(parsedJSON).toHaveProperty("msg.errorName");
        expect(parsedJSON).toHaveProperty("msg.errorMessage");
        expect(parsedJSON).toHaveProperty("msg.stackTrace");
        expect(parsedJSON).not.toHaveProperty("msg.errorCause");
      });

      test("should format an error message as JSON containing the error's 'cause'", () => {
        const error = new Error("Formatting error", {
          cause: new Error("Root error"),
        });
        const errorData = jsonErrorFormat(error);
        const header = `"timestamp":"2020-01-10T00:00:00.000Z", "level":"ERROR"`;
        const position = `"position":{"fileName":"index.ts","row":"1", "column":"10"}`;
        const expected = `{${header}, "prefix":"/api", ${position}, "msg": ${errorData}}`;

        const formatter = new JSONFormatter();
        const data: LogDataType = {
          level: "debug",
          msg: "A message",
          prefix: "/api",
          fileName: "index.ts",
          row: "1",
          column: "10",
        };

        const res = formatter.formatError(data, error);
        expect(expected).toEqualIgnoringWhitespace(res);
        expect(() => JSON.parse(res)).not.toThrow();
        const parsedJSON = JSON.parse(res);
        expect(parsedJSON).not.toHaveProperty("position.method");
        expect(parsedJSON).toHaveProperty("msg.errorName");
        expect(parsedJSON).toHaveProperty("msg.errorMessage");
        expect(parsedJSON).toHaveProperty("msg.errorCause");
        expect(parsedJSON).toHaveProperty("msg.stackTrace");
        expect(parsedJSON).toHaveProperty("msg.errorCause");
      });
    });
  });
});
