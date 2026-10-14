import { describe, expect, test } from "bun:test";
import { Logger } from "./logger.js";
import type { LogHost, PendingLogRecord } from "./types.js";

const createHost = () => {
  const records: PendingLogRecord[] = [];
  const host: LogHost = {
    onLogEmitted: (record) => {
      records.push(record);
    },
  };

  return { host, records };
};

describe("Logger", () => {
  test("emits body severity and scope", () => {
    const { host, records } = createHost();
    const logger = new Logger(host, { scopeName: "app", scopeVersion: "2" });

    logger.emit({
      severityText: "INFO",
      body: "hello",
      attributes: { a: 1 },
    });

    expect(records.length).toBe(1);
    expect(records[0]?.body).toBe("hello");
    expect(records[0]?.severityText).toBe("INFO");
    expect(records[0]?.severityNumber).toBe(9);
    expect(records[0]?.attributes).toEqual({ a: 1 });
    expect(records[0]?.scopeName).toBe("app");
    expect(records[0]?.scopeVersion).toBe("2");
  });

  test("maps known severity texts to severityNumber", () => {
    const cases: Array<[string, number]> = [
      ["TRACE", 1],
      ["debug", 5],
      ["WARN", 13],
      ["WARNING", 13],
      ["ERROR", 17],
      ["FATAL", 21],
    ];

    for (const [severityText, severityNumber] of cases) {
      const { host, records } = createHost();
      new Logger(host, { scopeName: "s" }).emit({
        severityText,
        body: "x",
      });
      expect(records[0]?.severityNumber).toBe(severityNumber);
    }
  });

  test("omits severityNumber for unknown severity text", () => {
    const { host, records } = createHost();
    new Logger(host, { scopeName: "s" }).emit({
      severityText: "NOTICE",
      body: "x",
    });
    expect(records[0]?.severityNumber).toBeUndefined();
  });

  test("uses provided timestamp", () => {
    const { host, records } = createHost();
    new Logger(host, { scopeName: "s" }).emit({
      severityText: "INFO",
      body: "x",
      timestamp: 1_700_000_000_000,
    });
    expect(records[0]?.timeUnixNano).toBe("1700000000000000000");
  });
});
