import { describe, expect, test } from "bun:test";
import { any, cronJobBuilder, list, number, range, step } from "./index.js";
import { Month, WeekDay } from "./types.js";

describe("Cron Expression Builder", () => {
  describe("Predefined scheduling definitions", () => {
    test("should emit @yearly expression", () => {
      const expr = cronJobBuilder((b) =>
        b.minute(number(0)).hour(number(0)).day(number(1)).month(number(1)),
      );

      expect(expr.split(" ")).toHaveLength(5);
      expect(expr).toEqual("0 0 1 1 *");
    });

    test("should emit @monthly expression", () => {
      const expr = cronJobBuilder((b) =>
        b.minute(number(0)).hour(number(0)).day(number(1)),
      );

      expect(expr.split(" ")).toHaveLength(5);
      expect(expr).toEqual("0 0 1 * *");
    });

    test("should emit @weekly expression", () => {
      const expr = cronJobBuilder((b) =>
        b.minute(number(0)).hour(number(0)).weekday(number(0)),
      );

      expect(expr.split(" ")).toHaveLength(5);
      expect(expr).toEqual("0 0 * * 0");
    });

    test("should emit @daily expression", () => {
      const expr = cronJobBuilder((b) => b.minute(number(0)).hour(number(0)));

      expect(expr.split(" ")).toHaveLength(5);
      expect(expr).toEqual("0 0 * * *");
    });

    test("should emit @hourly expression", () => {
      const expr = cronJobBuilder((b) => b.minute(number(0)));

      expect(expr.split(" ")).toHaveLength(5);
      expect(expr).toEqual("0 * * * *");
    });

    test("should emit @minutely expression", () => {
      const expr = cronJobBuilder((b) => b);

      expect(expr.split(" ")).toHaveLength(5);
      expect(expr).toEqual("* * * * *");
    });
  });

  describe("Custom expressions", () => {
    test("should emit an expression with the 'second' field", () => {
      const expr = cronJobBuilder((b) => b.second(any()));

      expect(expr.split(" ")).toHaveLength(6);
      expect(expr).toEqual("* * * * * *");
    });

    describe("Any", () => {
      test("should produce an 'any' expression", () => {
        const expr = cronJobBuilder((b) =>
          b
            .second(any())
            .minute(any())
            .hour(any())
            .day(any())
            .month(any())
            .weekday(any()),
        );

        expect(expr.split(" ")).toHaveLength(6);
        expect(expr).toEqual("* * * * * *");
      });
    });

    describe("Number", () => {
      test("should produce an expression with just numbers", () => {
        const expr = cronJobBuilder((b) =>
          b
            .second(number(2))
            .minute(number(19))
            .hour(number(20))
            .day(number(3))
            .month(number(Month.jul))
            .weekday(number(WeekDay.thu)),
        );

        expect(expr.split(" ")).toHaveLength(6);
        expect(expr).toEqual("2 19 20 3 7 4");
      });
    });

    describe("Range", () => {
      test("should emit an expression with a range", () => {
        const expr = cronJobBuilder((b) =>
          b
            .second(any())
            .hour(range({ min: 12, max: 20 }))
            .weekday(range({ min: 1, max: 3 })),
        );

        expect(expr.split(" ")).toHaveLength(6);
        expect(expr).toEqual("* * 12-20 * * 1-3");
      });

      test("should raise an error if range bounds are incorrect", () => {
        function inner() {
          cronJobBuilder((b) => b.hour(range({ min: 12, max: 1 })));
        }

        expect(inner).toThrow("OutOfBoundError");
      });
    });

    describe("Step", () => {
      test("should emit a simple 'step' expression", () => {
        const expr = cronJobBuilder((b) => b.day(step({ step: 2 })));

        expect(expr.split(" ")).toHaveLength(5);
        expect(expr).toEqual("* * */2 * *");
      });

      test("should emit a 'step' expression with a range", () => {
        const expr = cronJobBuilder((b) =>
          b.day(step({ step: 2, range: { min: 1, max: 3 } })),
        );

        expect(expr.split(" ")).toHaveLength(5);
        expect(expr).toEqual("* * 1-3/2 * *");
      });

      test("should emit a 'step' expression with only the minimun value for its range", () => {
        const expr = cronJobBuilder((b) =>
          b.day(step({ step: 2, range: { min: 1 } })),
        );

        expect(expr.split(" ")).toHaveLength(5);
        expect(expr).toEqual("* * 1/2 * *");
      });

      test("should raise an error if the step value is zero", () => {
        function zeroStepWithoutRange() {
          cronJobBuilder((b) => b.minute(step({ step: 0 })));
        }

        function zeroStepWithRange() {
          cronJobBuilder((b) => b.minute(step({ step: 0, range: { min: 1 } })));
        }

        expect(zeroStepWithoutRange).toThrow("OutOfBoundError");
        expect(zeroStepWithRange).toThrow("OutOfBoundError");
      });

      test("should raise an error if the step's range bounds are incorrect", () => {
        function inner() {
          cronJobBuilder((b) =>
            b.minute(step({ step: 3, range: { min: 10, max: 1 } })),
          );
        }

        expect(inner).toThrow("OutOfBoundError");
      });
    });

    describe("List", () => {
      test("should emit a simple list of numbers", () => {
        const expr = cronJobBuilder((b) =>
          b.second(list((l) => l.number(2).number(4).number(6))),
        );

        expect(expr.split(" ")).toHaveLength(6);
        expect(expr).toEqual("2,4,6 * * * * *");
      });

      test("should emit a more complex list", () => {
        const expr = cronJobBuilder((b) =>
          b
            .second(list((l) => l.number(2).number(4).number(6)))
            .month(list((l) => l.range({ min: 2, max: 4 }).number(10)))
            .weekday(list((l) => l.step({ step: 2 }).number(3))),
        );

        expect(expr.split(" ")).toHaveLength(6);
        expect(expr).toEqual("2,4,6 * * * 2-4,10 */2,3");
      });

      test("should reduce a one-element list to a simple expression", () => {
        const expr = cronJobBuilder((b) =>
          b.month(list((l) => l.range({ min: 2, max: 4 }))),
        );

        expect(expr.split(" ")).toHaveLength(5);
        expect(expr).toEqual("* * * 2-4 *");
      });
    });
  });
});
