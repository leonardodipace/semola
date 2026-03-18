import { beforeAll, describe, expect, setSystemTime, test } from "bun:test";
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
  type LogDataType,
  LogLevel,
  type LogLevelType,
  type LogMessageType,
} from "./types.js";

beforeAll(() => {
  setSystemTime(new Date("2020-01-10T00:00:00.000Z"));
});

type MockProviderResult = {
  msg: LogMessageType;
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

class MockFormatter extends Formatter {
  public format(logData: LogDataType): string {
    return JSON.stringify(logData);
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

    let { msg } = data;
    const [error] = mightThrowSync(() => {
      const { formatter } = this.options;
      msg = formatter?.format(data) ?? msg;
    });

    if (error && error instanceof Error) {
      const { formatter } = this.options;
      const errorMsg = formatter?.formatError(data, error) ?? "";
      return { msg: errorMsg, level: -1 };
    }

    switch (userLevel) {
      case LogLevel.debug:
        return { msg, level: userLevel };
      case LogLevel.info:
        return { msg, level: userLevel };
      case LogLevel.warning:
        return { msg, level: userLevel };
      case LogLevel.error:
        return { msg, level: userLevel };
      case LogLevel.critical:
        return { msg, level: userLevel };
      default:
        return { msg, level: LogLevel.debug };
    }
  }
}

function createMockProvider(level: LogLevelType = "debug") {
  return new MockConsoleProvider({
    level: level,
    formatter: new MockFormatter(isoDateFormat),
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
        const mockProvider = createMockProvider();
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
        const mockProvider = createMockProvider();
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
        const mockProvider = createMockProvider(data.level);

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
        const mockProvider = createMockProvider(data.level);
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
        const mockProvider = createMockProvider(data.level);
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
        const mockProvider = createMockProvider("critical");
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
        const mockProvider = createMockProvider();
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
