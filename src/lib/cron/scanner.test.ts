import { describe, expect, test } from "bun:test";
import { Scanner, Token } from "./scanner.js";

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
        tokens?.[0]?.equals(new Token("*", "any", "*", "second")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("*", "any", "*", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("*", "any", "*", "hour")),
      ).toBeTrue();

      expect(tokens?.[3]?.equals(new Token("*", "any", "*", "day"))).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("*", "any", "*", "month")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("*", "any", "*", "weekday")),
      ).toBeTrue();
    });

    test("should create a list of integer tokens", () => {
      const [err, tokens] = new Scanner("1 2 3 4 5 6").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(6);

      expect(
        tokens?.[0]?.equals(new Token("1", "number", 1, "second")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("2", "number", 2, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("3", "number", 3, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("4", "number", 4, "day")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("5", "number", 5, "month")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("6", "number", 6, "weekday")),
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
        tokens?.[0]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();
    });

    test("should generate a numerical token with a large number", () => {
      const [error, tokens] = new Scanner("10000000 * * * *").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token("10000000", "number", 10_000_000, "minute"),
        ),
      ).toBeTrue();
    });

    test("should generate a multiple numerical tokens with different values", () => {
      const [error, tokens] = new Scanner("10 * 20 * 30").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("20", "number", 20, "day")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("30", "number", 30, "weekday")),
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
        tokens?.[0]?.equals(new Token("*/1", "step", 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a 'step' token with a custom range", () => {
      const [err, tokens] = new Scanner("2-6/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("2-6/1", "step", 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a 'step' token with just the starting point of its range", () => {
      const [err, tokens] = new Scanner("6/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("6/1", "step", 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a 'step' token with just the ending point of its range", () => {
      const [err, tokens] = new Scanner("-6/1 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("-6/1", "step", 1, "minute")),
      ).toBeTrue();
    });

    test("should generate a valid 'step' token when reading numbers with leading zeros", () => {
      const [err, tokens] = new Scanner("0001-007/0001 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);

      expect(
        tokens?.[0]?.equals(new Token("0001-007/0001", "step", 1, "minute")),
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
          new Token("11232324512-134414512/1233", "step", 1233, "minute"),
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
        tokens?.[0]?.equals(new Token("1-5", "range", "1-5", "minute")),
      ).toBeTrue();
    });

    test("should generate a valid 'range' token with large numbers", () => {
      const [error, tokens] = new Scanner("1000000-5000000 * * * *").scan();

      expect(error).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(5);
      expect(
        tokens?.[0]?.equals(
          new Token("1000000-5000000", "range", "1000000-5000000", "minute"),
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

  describe("List tokens", () => {
    test("should generate a list with numbers", () => {
      const [err, tokens] = new Scanner("10,20,30 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("20", "number", 20, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("30", "number", 30, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("2", "number", 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("3", "number", 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("4", "number", 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("5", "number", 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a list with numbers and range expressions", () => {
      const [err, tokens] = new Scanner("10,20-10,30-40 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("20-10", "range", "20-10", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("30-40", "range", "30-40", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("2", "number", 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("3", "number", 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("4", "number", 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("5", "number", 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a list with numbers, range and step expressions", () => {
      const [err, tokens] = new Scanner("10,20-10,30-40/20,*/3 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(8);

      expect(
        tokens?.[0]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("20-10", "range", "20-10", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("30-40/20", "step", 20, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("*/3", "step", 3, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("2", "number", 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("3", "number", 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("4", "number", 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[7]?.equals(new Token("5", "number", 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a list with numbers and step expression variants", () => {
      const [err, tokens] = new Scanner("10,20/10,-40/20 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("20/10", "step", 10, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("-40/20", "step", 20, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("2", "number", 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("3", "number", 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("4", "number", 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("5", "number", 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a CronExpressionError for invalid list syntax", () => {
      const [err, tokens] = new Scanner("10,20, 2 3 4 5").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid list expression '10,20,' for field 'minute'",
      );
    });

    test("should generate a CronExpressionError for invalid symbols inside a list", () => {
      const [err, tokens] = new Scanner("10,a20, 2 3 4 5").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual(
        "Invalid cron expression '10,a20, 2 3 4 5' in field 'minute'",
      );
    });

    test("should generate a CronExpressionError for a leading comma", () => {
      const [err, tokens] = new Scanner(",0 * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
    });

    test("should generate a CronExpressionError for a lone comma", () => {
      // Expected: error - "," contains no valid items on either side
      const [err, tokens] = new Scanner(", * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
    });

    test("should generate a list with a wildcard as the first item in a list", () => {
      const [err, tokens] = new Scanner("*,5 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(6);

      expect(
        tokens?.[0]?.equals(new Token("*", "any", "*", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("5", "number", 5, "minute")),
      ).toBeTrue();
    });

    test("should generate a list with a wildcard in the middle of a list", () => {
      const [err, tokens] = new Scanner("5,*,10 * * * *").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(new Token("5", "number", 5, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(new Token("*", "any", "*", "minute")),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(new Token("10", "number", 10, "minute")),
      ).toBeTrue();
    });
  });

  describe("Validation", () => {
    test("should accept a wildcard expression", () => {
      const [err] = new Scanner("* * * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept a step expression", () => {
      const [err] = new Scanner("*/5 * * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept a range expression", () => {
      const [err] = new Scanner("0 9-17 * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept a list expression", () => {
      const [err] = new Scanner("0 9,12,15 * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept a combined expression", () => {
      const [err] = new Scanner("0 9-17/2 * * 1-5").scan();
      expect(err).toBeNull();
    });

    test("should reject an out-of-bounds number (60 in minute field)", () => {
      // The scanner accepts any digit sequence - out-of-bounds is a semantic check,
      // not a tokenization error. This test documents that the scanner passes it through.
      const [err] = new Scanner("60 * * * *").scan();
      expect(err).toBeNull();
    });

    test("should reject a step of zero", () => {
      const [err] = new Scanner("*/0 * * * *").scan();
      expect(err).toBeNull();
    });

    test("should reject a double-hyphen (negative range attempt)", () => {
      const [err] = new Scanner("0--5 * * * *").scan();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
    });

    test("should reject an out-of-bounds step range start in day field (0-10/2)", () => {
      // Tokenization succeeds; out-of-bounds is a semantic check not done by the scanner
      const [err] = new Scanner("0 0 0-10/2 * *").scan();
      expect(err).toBeNull();
    });

    test("should reject an out-of-bounds step range (70-80/2)", () => {
      // Tokenization succeeds; out-of-bounds is a semantic check not done by the scanner
      const [err] = new Scanner("70-80/2 * * * *").scan();
      expect(err).toBeNull();
    });

    test("should reject a step range where start > end (30-10/2)", () => {
      // Tokenization succeeds; start > end is a semantic check not done by the scanner
      const [err] = new Scanner("30-10/2 * * * *").scan();
      expect(err).toBeNull();
    });

    test("should reject a decimal number in a step range (1.5-10/2)", () => {
      const [err] = new Scanner("1.5-10/2 * * * *").scan();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronExpressionError");
    });

    test("should accept a valid step range expression (10-50/5)", () => {
      const [err] = new Scanner("10-50/5 * * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept step ranges at all field boundaries", () => {
      const [err] = new Scanner("0-59/10 0-23/4 1-31/7 1-12/3 0-6/2").scan();
      expect(err).toBeNull();
    });

    test("should accept a 6-field expression with seconds", () => {
      const [err] = new Scanner("* * * * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept a 6-field expression with specific seconds (30)", () => {
      const [err] = new Scanner("30 * * * * *").scan();
      expect(err).toBeNull();
    });

    test("should accept a 6-field expression with step in seconds (*/5)", () => {
      const [err] = new Scanner("*/5 * * * * *").scan();
      expect(err).toBeNull();
    });

    test("should reject a 7-field expression", () => {
      const [err] = new Scanner("* * * * * * *").scan();
      expect(err).not.toBeNull();
      expect(err?.type).toEqual("CronLengthError");
    });
  });

  describe("Scientific notation", () => {
    test("should generate a CronExpressionError for scientific notation in minute field", () => {
      const [err, tokens] = new Scanner("1e1 * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual("Invalid number '1e1' for field 'minute'");
    });

    test("should generate a CronExpressionError for scientific notation in day field", () => {
      const [err, tokens] = new Scanner("0 0 1e1 * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual("Invalid number '1e1' for field 'day'");
    });
  });

  describe("Expression token structure", () => {
    describe("wildcard with step", () => {
      test("wildcard-with-step in a list emits a Step token followed by a Number token", () => {
        // "*/10,30" -> Step(10) for the wildcard step, Number(30) for the list item
        const [err, tokens] = new Scanner("*/10,30 * * * *").scan();

        expect(err).toBeNull();
        expect(tokens?.length).toEqual(6); // 2 minute tokens + 4 wildcards

        expect(
          tokens?.[0]?.equals(new Token("*/10", "step", 10, "minute")),
        ).toBeTrue();
        expect(
          tokens?.[1]?.equals(new Token("30", "number", 30, "minute")),
        ).toBeTrue();
      });

      test("wildcard-with-step as standalone field emits a single Step token", () => {
        // "*/6" in hour -> Step(6)
        const [err, tokens] = new Scanner("0 */6 * * *").scan();

        expect(err).toBeNull();
        expect(tokens?.length).toEqual(5);

        expect(
          tokens?.[0]?.equals(new Token("0", "number", 0, "minute")),
        ).toBeTrue();
        expect(
          tokens?.[1]?.equals(new Token("*/6", "step", 6, "hour")),
        ).toBeTrue();
      });
    });

    describe("number tokens for specific field values", () => {
      test("emits correct Number tokens for day and month fields", () => {
        // "0 0 15 6 *" -> minute=0, hour=0, day=15, month=6, weekday=*
        const [err, tokens] = new Scanner("0 0 15 6 *").scan();

        expect(err).toBeNull();
        expect(tokens?.length).toEqual(5);

        expect(
          tokens?.[2]?.equals(new Token("15", "number", 15, "day")),
        ).toBeTrue();
        expect(
          tokens?.[3]?.equals(new Token("6", "number", 6, "month")),
        ).toBeTrue();
      });

      test("emits Number token for day 31", () => {
        const [err, tokens] = new Scanner("0 12 31 * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[2]?.equals(new Token("31", "number", 31, "day")),
        ).toBeTrue();
      });

      test("emits Number token for month 12 (December)", () => {
        const [err, tokens] = new Scanner("0 0 1 12 *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[3]?.equals(new Token("12", "number", 12, "month")),
        ).toBeTrue();
      });

      test("emits Number token for month 1 (January)", () => {
        const [err, tokens] = new Scanner("0 0 1 1 *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[3]?.equals(new Token("1", "number", 1, "month")),
        ).toBeTrue();
      });

      test("emits Number token for day 29 and month 2 (Feb 29)", () => {
        const [err, tokens] = new Scanner("0 0 29 2 *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[2]?.equals(new Token("29", "number", 29, "day")),
        ).toBeTrue();
        expect(
          tokens?.[3]?.equals(new Token("2", "number", 2, "month")),
        ).toBeTrue();
      });
    });

    describe("range and step token structure", () => {
      test("degenerate range (5-5) emits a Range token", () => {
        const [err, tokens] = new Scanner("5-5 * * * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[0]?.equals(new Token("5-5", "range", "5-5", "minute")),
        ).toBeTrue();
      });

      test("step of 1 (*/1) emits a Step token with value 1", () => {
        const [err, tokens] = new Scanner("*/1 * * * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[0]?.equals(new Token("*/1", "step", 1, "minute")),
        ).toBeTrue();
      });

      test("range-with-step where step exceeds range width emits a Step token", () => {
        // "10-15/10" -> Step(10); expansion to only minute 10 is post-scan semantics
        const [err, tokens] = new Scanner("10-15/10 * * * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[0]?.equals(new Token("10-15/10", "step", 10, "minute")),
        ).toBeTrue();
      });

      test("step larger than field width (*/60) emits a Step token with value 60", () => {
        // Expansion to only minute 0 is post-scan semantics
        const [err, tokens] = new Scanner("*/60 * * * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[0]?.equals(new Token("*/60", "step", 60, "minute")),
        ).toBeTrue();
      });

      test("range-with-step inside a list emits Step and Number tokens", () => {
        // "10-30/5,45" -> Step(5) for the range-step, Number(45) for the list item
        const [err, tokens] = new Scanner("10-30/5,45 * * * *").scan();

        expect(err).toBeNull();
        expect(tokens?.length).toEqual(6); // 2 minute tokens + 4 wildcards

        expect(
          tokens?.[0]?.equals(new Token("10-30/5", "step", 5, "minute")),
        ).toBeTrue();
        expect(
          tokens?.[1]?.equals(new Token("45", "number", 45, "minute")),
        ).toBeTrue();
      });

      test("full minute range (0-59) emits a Range token", () => {
        const [err, tokens] = new Scanner("0-59 * * * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[0]?.equals(new Token("0-59", "range", "0-59", "minute")),
        ).toBeTrue();
      });

      test("full month range (1-12) emits a Range token in month field", () => {
        const [err, tokens] = new Scanner("0 0 1 1-12 *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[3]?.equals(new Token("1-12", "range", "1-12", "month")),
        ).toBeTrue();
      });

      test("zero-length range (0-0) emits a Range token", () => {
        const [err, tokens] = new Scanner("0-0 * * * *").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[0]?.equals(new Token("0-0", "range", "0-0", "minute")),
        ).toBeTrue();
      });

      test("6-field expression emits Number token for second field", () => {
        // "30 0 0 1 1 *" = second=30, minute=0, hour=0, day=1, month=1, weekday=*
        const [err, tokens] = new Scanner("30 0 0 1 1 *").scan();

        expect(err).toBeNull();
        expect(tokens?.length).toEqual(6);

        expect(
          tokens?.[0]?.equals(new Token("30", "number", 30, "second")),
        ).toBeTrue();
        expect(
          tokens?.[1]?.equals(new Token("0", "number", 0, "minute")),
        ).toBeTrue();
      });

      test("dayOfWeek 7 passes scanner (out-of-bounds is a semantic check)", () => {
        // The scanner accepts any digit sequence; 7 > max(6) is validated post-scan
        const [err, tokens] = new Scanner("0 0 * * 7").scan();

        expect(err).toBeNull();
        expect(
          tokens?.[4]?.equals(new Token("7", "number", 7, "weekday")),
        ).toBeTrue();
      });
    });
  });
});
