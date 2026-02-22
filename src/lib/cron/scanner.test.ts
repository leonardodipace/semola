import { describe, expect, test } from "bun:test";
import { ComponentEnum, Scanner, Token } from "./scanner.js";

describe("Cron Scanner", () => {
  describe("Simple expression", () => {
    test("should have a valid length", () => {
      const [errOne, fiveTokens] = new Scanner("* * * * *").scan();
      const [errTwo, sixTokens] = new Scanner("* * * * * *").scan();

      expect(errOne).toBeNull();
      expect(errTwo).toBeNull();
      expect(fiveTokens).toBeArray();
      expect(sixTokens).toBeArray();
      expect(fiveTokens?.length).toEqual(5);
      expect(sixTokens?.length).toEqual(6);
    });

    test("should ignore multiple white spaces, tabs", () => {
      const [err, tokens] = new Scanner(
        "*    * \t*  \t\n\r  * \t  * \t\r  *",
      ).scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(6);

      expect(
        tokens?.[0]?.equals(new Token("*", ComponentEnum.Any, "*", "second")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("*", ComponentEnum.Any, "*", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("*", ComponentEnum.Any, "*", "hour")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("*", ComponentEnum.Any, "*", "day")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("*", ComponentEnum.Any, "*", "month")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("*", ComponentEnum.Any, "*", "weekday")),
      ).toBeTrue();
    });

    test("should create an list of integer tokens", () => {
      const [err, tokens] = new Scanner("1 2 3 4 5 6").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(6);

      expect(
        tokens?.[0]?.equals(new Token("1", ComponentEnum.Number, 1, "second")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("2", ComponentEnum.Number, 2, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("3", ComponentEnum.Number, 3, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("4", ComponentEnum.Number, 4, "day")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("5", ComponentEnum.Number, 5, "month")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("6", ComponentEnum.Number, 6, "weekday")),
      ).toBeTrue();
    });

    test("should generate EmptyCronExpressionError for an empty string", () => {
      const [err, tokens] = new Scanner("").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("EmptyCronExpressionError");
      expect(err?.message).toEqual("Cron expression have zero length");
    });

    test("should generate CronLengthError", () => {
      const [errOne, tokensOne] = new Scanner("* * *").scan();
      const [errTwo, tokensTwo] = new Scanner("* * * * * * * *").scan();

      expect(errOne).not.toBeNull();
      expect(errTwo).not.toBeNull();
      expect(tokensOne).toBeNull();
      expect(tokensTwo).toBeNull();

      expect(errOne?.type).toEqual("CronLengthError");
      expect(errOne?.message).toEqual(
        "Invalid number of fields for '* * *'. Expected 5 or 6 fields but got 3 field(s)",
      );
      expect(errTwo?.type).toEqual("CronLengthError");
      expect(errTwo?.message).toEqual(
        "Invalid number of fields for '* * * * * * * *'. Expected 5 or 6 fields but got 8 field(s)",
      );
    });

    test("should generate CronExpressionError for reading an invalid symbol", () => {
      const [err, tokens] = new Scanner("t * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid cron expression 't * * * *' in field 'minute'",
      );
    });
  });

  describe("Number tokens", () => {
    test("should generate a numerical token", () => {
      const [error, tokens] = new Scanner("10 * * * *").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token("10", ComponentEnum.Number, 10, "minute"),
        ),
      ).toBeTrue();
    });

    test("should generate a numerical token with a large number", () => {
      const [error, tokens] = new Scanner("10000000 * * * *").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token("10000000", ComponentEnum.Number, 10_000_000, "minute"),
        ),
      ).toBeTrue();
    });

    test("should generate a multiple numerical tokens with different values", () => {
      const [error, tokens] = new Scanner("10 * 20 * 30").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token("10", ComponentEnum.Number, 10, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("20", ComponentEnum.Number, 20, "day")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(
          new Token("30", ComponentEnum.Number, 30, "weekday"),
        ),
      ).toBeTrue();
    });

    test("should generate a CronExpressionError for an invalid symbol", () => {
      const [err, tokens] = new Scanner("10 * 20 * 3s0").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual("Invalid number '3s0' for field 'weekday'");
    });

    test("should generate a CronExpressionError for a decimal number with just a decimal point", () => {
      const [err, tokens] = new Scanner("10. * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual("Invalid number '10.' for field 'minute'");
    });
  });

  describe("Step tokens", () => {
    test("should generate a 'step' token without a custom range", () => {
      const [err, tokens] = new Scanner("*/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("*/1", ComponentEnum.Step, 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a 'step' token with a custom range", () => {
      const [err, tokens] = new Scanner("2-6/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(
          new Token("2-6/1", ComponentEnum.Step, 1, "minute"),
        ),
      ).toBeTrue();
    });

    test("should generate a 'step' token with just the starting point of its range", () => {
      const [err, tokens] = new Scanner("6/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("6/1", ComponentEnum.Step, 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a 'step' token with just the ending point of its range", () => {
      const [err, tokens] = new Scanner("-6/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("-6/1", ComponentEnum.Step, 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a valid 'step' token when reading numbers with leading zeros", () => {
      const [err, tokens] = new Scanner("0001-007/0001 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(
          new Token("0001-007/0001", ComponentEnum.Step, 1, "minute"),
        ),
      ).toBeTrue();
    });

    test("should generate a CronExpressionError for a step expression with decimal point but no fraction", () => {
      const [err, tokens] = new Scanner("*/10. * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid step expression '*/10.' for field 'minute'",
      );
    });

    test("should generate a 'step' token with a very long range", () => {
      const [err, tokens] = new Scanner(
        "11232324512-134414512/1233 * * * *",
      ).scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(
          new Token(
            "11232324512-134414512/1233",
            ComponentEnum.Step,
            1233,
            "minute",
          ),
        ),
      ).toBeTrue();
    });

    test("should generate CronExpressionError for a step expression without its step value", () => {
      const [err, tokens] = new Scanner("1-2/ * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid step expression '1-2/' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for a step expression with multiple asterisk", () => {
      const [err, tokens] = new Scanner("**/1 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid any expression '**/1' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for a step expression with invalid symbols", () => {
      const [err, tokens] = new Scanner("1-32/2a41 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid step expression '1-32/2a41' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for a step expression with a backslash symbol", () => {
      const [err, tokens] = new Scanner("*/\\2 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid step expression '*/\\2' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for a step expression with multiple slash symbols", () => {
      const [err, tokens] = new Scanner("*/2/ * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid step expression '*/2/' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for a step expression with a range as a step value", () => {
      const [err, tokens] = new Scanner("*/2-4 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid step expression '*/2-4' for field 'minute'",
      );
    });
  });

  describe("Range tokens", () => {
    test("should generate a valid 'range' token", () => {
      const [error, tokens] = new Scanner("1-5 * * * *").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token("1-5", ComponentEnum.Range, "1-5", "minute"),
        ),
      ).toBeTrue();
    });

    test("should generate a valid 'range' token with large numbers", () => {
      const [error, tokens] = new Scanner("1000000-5000000 * * * *").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token(
            "1000000-5000000",
            ComponentEnum.Range,
            "1000000-5000000",
            "minute",
          ),
        ),
      ).toBeTrue();
    });

    test("should generate CronExpressionError for invalid symbols", () => {
      const [err, tokens] = new Scanner("100-5a0 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid range expression '100-5a0' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for missing the starting point", () => {
      const [err, tokens] = new Scanner("-50 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid range expression '-50' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for missing the ending point", () => {
      const [err, tokens] = new Scanner("10- * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid range expression '10-' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for multiple hyphen", () => {
      const [err, tokens] = new Scanner("10--1 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid range expression '10--1' for field 'minute'",
      );
    });

    test("should generate CronExpressionError for multiple consecutive hyphen", () => {
      const [err, tokens] = new Scanner("10-3-1 * * * *").scan();

      expect(tokens).toBeNull();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid range expression '10-3-1' for field 'minute'",
      );
    });
  });
});
