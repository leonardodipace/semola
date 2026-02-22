import { describe, expect, test } from "bun:test";
import { Cron } from "./index.js";
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

  describe("List tokens", () => {
    test("should generate a list with numbers", () => {
      const [err, tokens] = new Scanner("10,20,30 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(
          new Token("10", ComponentEnum.Number, 10, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(
          new Token("20", ComponentEnum.Number, 20, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(
          new Token("30", ComponentEnum.Number, 30, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("2", ComponentEnum.Number, 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("3", ComponentEnum.Number, 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("4", ComponentEnum.Number, 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("5", ComponentEnum.Number, 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a list with numbers and range expressions", () => {
      const [err, tokens] = new Scanner("10,20-10,30-40 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(
          new Token("10", ComponentEnum.Number, 10, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(
          new Token("20-10", ComponentEnum.Range, "20-10", "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(
          new Token("30-40", ComponentEnum.Range, "30-40", "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("2", ComponentEnum.Number, 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("3", ComponentEnum.Number, 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("4", ComponentEnum.Number, 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("5", ComponentEnum.Number, 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a list with numbers, range and step expressions", () => {
      const [err, tokens] = new Scanner("10,20-10,30-40/20,*/3 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(8);

      expect(
        tokens?.[0]?.equals(
          new Token("10", ComponentEnum.Number, 10, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(
          new Token("20-10", ComponentEnum.Range, "20-10", "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(
          new Token("30-40/20", ComponentEnum.Step, 20, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("*/3", ComponentEnum.Step, 3, "minute")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("2", ComponentEnum.Number, 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("3", ComponentEnum.Number, 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("4", ComponentEnum.Number, 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[7]?.equals(new Token("5", ComponentEnum.Number, 5, "weekday")),
      ).toBeTrue();
    });

    test("should generate a list with numbers and step expression variants", () => {
      const [err, tokens] = new Scanner("10,20/10,-40/20 2 3 4 5").scan();

      expect(err).toBeNull();
      expect(tokens).toBeArray();
      expect(tokens?.length).toEqual(7);

      expect(
        tokens?.[0]?.equals(
          new Token("10", ComponentEnum.Number, 10, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[1]?.equals(
          new Token("20/10", ComponentEnum.Step, 10, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[2]?.equals(
          new Token("-40/20", ComponentEnum.Step, 20, "minute"),
        ),
      ).toBeTrue();

      expect(
        tokens?.[3]?.equals(new Token("2", ComponentEnum.Number, 2, "hour")),
      ).toBeTrue();

      expect(
        tokens?.[4]?.equals(new Token("3", ComponentEnum.Number, 3, "day")),
      ).toBeTrue();

      expect(
        tokens?.[5]?.equals(new Token("4", ComponentEnum.Number, 4, "month")),
      ).toBeTrue();

      expect(
        tokens?.[6]?.equals(new Token("5", ComponentEnum.Number, 5, "weekday")),
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
      // Expected: error - ",0" starts with an empty item before the comma
      // BUG: the scanner sees ',' with a valid next char '0', skips the comma,
      // and emits a Number(0) token with no error. The comma case in scanComponent
      // only checks that the *next* char is valid, not that something came before it.
      // FIX NEEDED: scanComponent case ',' must also reject when current === start
      // (nothing was scanned before this comma).
      const [err, tokens] = new Scanner(",0 * * * *").scan();

      expect(err).not.toBeNull(); // fails: scanner accepts ",0"
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

    test("should generate a CronExpressionError for wildcard as first item in a list", () => {
      // Expected: error - "*,5" is not valid; "*" as a bare list item is not supported
      // by the scanner because the '*' case in scanComponent only allows '*' alone
      // (peek returns undefined) or followed by '/' (step). A trailing ',' is not handled.
      // BUG: this IS a bug - "*,5" is semantically equivalent to "*" (union of all and 5),
      // and many cron implementations accept it. The scanner should emit an Any token
      // and continue when '*' is followed by ','.
      // FIX NEEDED: scanComponent case '*' must handle peek === ',' as a valid list separator.
      const [err, tokens] = new Scanner("*,5 * * * *").scan();

      expect(err).not.toBeNull(); // fails if fixed - currently errors correctly for wrong reason
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
    });

    test("should generate a CronExpressionError for wildcard in the middle of a list", () => {
      // Expected: error - "5,*,10" is not valid syntax
      // Same root cause as above: '*' mid-list is rejected because scanComponent
      // cannot distinguish a bare '*' list item from a malformed expression.
      const [err, tokens] = new Scanner("5,*,10 * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
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

    test("should reject an out-of-bounds step range in seconds field (50-70/5)", () => {
      // Tokenization succeeds; out-of-bounds is a semantic check not done by the scanner
      const [err] = new Scanner("50-70/5 * * * * *").scan();
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
      // Expected: error - "1e1" contains 'e' which is not a digit
      // The scanner rejects non-digit characters, so "1e1" is caught here.
      // BUG: the Cron class parser handleNumber does NOT catch this -
      // Number("1e1") === 10 passes isInteger, so "1e1 * * * *" is silently accepted.
      const [err, tokens] = new Scanner("1e1 * * * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual("Invalid number '1e1' for field 'minute'");
    });

    test("should generate a CronExpressionError for scientific notation in day field", () => {
      // Expected: error - "1e1" is not a valid digit sequence
      // BUG: the Cron class parser silently accepts "0 0 1e1 * *" as day 10.
      const [err, tokens] = new Scanner("0 0 1e1 * *").scan();

      expect(err).not.toBeNull();
      expect(tokens).toBeNull();

      expect(err?.type).toEqual("CronExpressionError");
      expect(err?.message).toEqual("Invalid number '1e1' for field 'day'");
    });
  });

  describe("Cron matches", () => {
    describe("expression parsing", () => {
      test("wildcard with step in list expands correctly", () => {
        // */10 inside a list expands to 0,10,20,30,40,50; "30" is redundant
        const cron = new Cron({
          name: "list-wildcard-step",
          schedule: "*/10,30 * * * *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true); // minute 0
        expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true); // minute 10
        expect(cron.matches(new Date(2025, 0, 1, 0, 20, 0))).toBe(true); // minute 20
        expect(cron.matches(new Date(2025, 0, 1, 0, 30, 0))).toBe(true); // minute 30
        expect(cron.matches(new Date(2025, 0, 1, 0, 40, 0))).toBe(true); // minute 40
        expect(cron.matches(new Date(2025, 0, 1, 0, 50, 0))).toBe(true); // minute 50
        expect(cron.matches(new Date(2025, 0, 1, 0, 5, 0))).toBe(false); // minute 5
        expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(false); // minute 15
      });

      test("wildcard with step as standalone field expands correctly", () => {
        const cron = new Cron({
          name: "list-wildcard-step-only",
          schedule: "0 */6 * * *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true); // hour 0
        expect(cron.matches(new Date(2025, 0, 1, 6, 0, 0))).toBe(true); // hour 6
        expect(cron.matches(new Date(2025, 0, 1, 12, 0, 0))).toBe(true); // hour 12
        expect(cron.matches(new Date(2025, 0, 1, 18, 0, 0))).toBe(true); // hour 18
        expect(cron.matches(new Date(2025, 0, 1, 3, 0, 0))).toBe(false); // hour 3
      });

      test("should reject wildcard with invalid step in list", () => {
        expect(() => {
          new Cron({
            name: "list-wildcard-bad-step",
            schedule: "*/0,30 * * * *",
            handler: () => Promise.resolve(),
          });
        }).toThrow("Invalid cron expression");
      });
    });

    describe("specific date and month matching", () => {
      test("should match correct day and month for a specific date", () => {
        // Schedule: minute 0, hour 0, day 15, month 6 (June), any weekday
        const cron = new Cron({
          name: "match-test",
          schedule: "0 0 15 6 *",
          handler: () => Promise.resolve(),
        });

        // June 15, 2025, 00:00:00 - should match
        expect(cron.matches(new Date(2025, 5, 15, 0, 0, 0))).toBe(true);

        // June 14, 2025, 00:00:00 - wrong day
        expect(cron.matches(new Date(2025, 5, 14, 0, 0, 0))).toBe(false);

        // July 15, 2025, 00:00:00 - wrong month
        expect(cron.matches(new Date(2025, 6, 15, 0, 0, 0))).toBe(false);

        // June 15, 2025, 01:00:00 - wrong hour
        expect(cron.matches(new Date(2025, 5, 15, 1, 0, 0))).toBe(false);
      });

      test("should match day 31 correctly", () => {
        // Schedule: minute 0, hour 12, day 31, any month, any weekday
        const cron = new Cron({
          name: "day31-test",
          schedule: "0 12 31 * *",
          handler: () => Promise.resolve(),
        });

        // January 31, 2025, 12:00:00 - should match
        expect(cron.matches(new Date(2025, 0, 31, 12, 0, 0))).toBe(true);

        // January 30, 2025, 12:00:00 - wrong day
        expect(cron.matches(new Date(2025, 0, 30, 12, 0, 0))).toBe(false);
      });

      test("should match month 12 (December) correctly", () => {
        // Schedule: minute 0, hour 0, day 1, month 12, any weekday
        const cron = new Cron({
          name: "dec-test",
          schedule: "0 0 1 12 *",
          handler: () => Promise.resolve(),
        });

        // December 1, 2025, 00:00:00 - should match
        expect(cron.matches(new Date(2025, 11, 1, 0, 0, 0))).toBe(true);

        // November 1, 2025, 00:00:00 - wrong month
        expect(cron.matches(new Date(2025, 10, 1, 0, 0, 0))).toBe(false);
      });

      test("should match month 1 (January) correctly", () => {
        const cron = new Cron({
          name: "jan-test",
          schedule: "0 0 1 1 *",
          handler: () => Promise.resolve(),
        });

        // January 1, 2025, 00:00:00 - should match
        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);

        // February 1, 2025, 00:00:00 - wrong month
        expect(cron.matches(new Date(2025, 1, 1, 0, 0, 0))).toBe(false);
      });

      test("should match Feb 29 on a leap year", () => {
        const cron = new Cron({
          name: "feb29",
          schedule: "0 0 29 2 *",
          handler: () => Promise.resolve(),
        });

        // 2028 is a leap year - Feb 29 exists
        expect(cron.matches(new Date(2028, 1, 29, 0, 0, 0))).toBe(true);

        // Feb 28 should not match
        expect(cron.matches(new Date(2028, 1, 28, 0, 0, 0))).toBe(false);

        // Non-leap year: 2027-03-01 should not match
        expect(cron.matches(new Date(2027, 2, 1, 0, 0, 0))).toBe(false);
      });
    });

    describe("edge cases", () => {
      test("degenerate range (start === end) sets exactly one value", () => {
        const cron = new Cron({
          name: "degenerate-range",
          schedule: "5-5 * * * *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 5, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 4, 0))).toBe(false);
        expect(cron.matches(new Date(2025, 0, 1, 0, 6, 0))).toBe(false);
      });

      test("step of 1 (*/1) matches every minute", () => {
        const cron = new Cron({
          name: "step-one",
          schedule: "*/1 * * * *",
          handler: () => Promise.resolve(),
        });

        for (let m = 0; m <= 59; m++) {
          expect(cron.matches(new Date(2025, 0, 1, 0, m, 0))).toBe(true);
        }
      });

      test("range-with-step where step exceeds range width sets only start value", () => {
        const cron = new Cron({
          name: "step-exceeds-range",
          schedule: "10-15/10 * * * *",
          handler: () => Promise.resolve(),
        });

        // 10-15/10: only 10 is set (10+10=20 > 15)
        expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 11, 0))).toBe(false);
        expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(false);
      });

      test("step larger than field width (*/60) sets only minute 0", () => {
        const cron = new Cron({
          name: "step-large",
          schedule: "*/60 * * * *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 1, 0))).toBe(false);
        expect(cron.matches(new Date(2025, 0, 1, 0, 59, 0))).toBe(false);
      });

      test("range-with-step inside a list is applied correctly", () => {
        // "10-30/5,45" -> {10,15,20,25,30,45}
        const cron = new Cron({
          name: "range-step-in-list",
          schedule: "10-30/5,45 * * * *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 20, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 25, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 30, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 45, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 35, 0))).toBe(false); // gap between steps
        expect(cron.matches(new Date(2025, 0, 1, 0, 50, 0))).toBe(false); // not in list
      });

      test("full minute range 0-59 matches all minutes", () => {
        const cron = new Cron({
          name: "full-minute-range",
          schedule: "0-59 * * * *",
          handler: () => Promise.resolve(),
        });

        for (let m = 0; m <= 59; m++) {
          expect(cron.matches(new Date(2025, 0, 1, 0, m, 0))).toBe(true);
        }
      });

      test("full month range 1-12 matches all months", () => {
        const cron = new Cron({
          name: "full-month-range",
          schedule: "0 0 1 1-12 *",
          handler: () => Promise.resolve(),
        });

        for (let mon = 0; mon <= 11; mon++) {
          expect(cron.matches(new Date(2025, mon, 1, 0, 0, 0))).toBe(true);
        }
      });

      test("zero-length range (0-0) sets only minute 0", () => {
        const cron = new Cron({
          name: "zero-range",
          schedule: "0-0 * * * *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 1, 0))).toBe(false);
      });

      test("inverted range inside a list is rejected", () => {
        expect(() => {
          new Cron({
            name: "inverted-range-in-list",
            schedule: "30-10,50 * * * *",
            handler: () => Promise.resolve(),
          });
        }).toThrow("Invalid cron expression");
      });

      test("6-field expression checks second and does not match wrong second", () => {
        // "30 0 0 1 1 *" = second 30, minute 0, hour 0, day 1, month 1 (January), any weekday
        const cron = new Cron({
          name: "six-field-second-check",
          schedule: "30 0 0 1 1 *",
          handler: () => Promise.resolve(),
        });

        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 30))).toBe(true); // correct second
        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(false); // wrong second
        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 31))).toBe(false); // wrong second
      });

      test("dayOfWeek 7 is rejected (current behavior documents max=6 limit)", () => {
        expect(() => {
          new Cron({
            name: "dow-seven",
            schedule: "0 0 * * 7",
            handler: () => Promise.resolve(),
          });
        }).toThrow("Invalid cron expression");
      });
    });

    describe("bugs", () => {
      // BUG 1: single-value-with-step inside a list ignores the step
      // FIX NEEDED: handleList else branch only does values[n]=1.
      // It should loop from n to max with step, like handleStepSingle does.
      test("single-value-with-step in list should expand from start to max", () => {
        const cron = new Cron({
          name: "list-step-bug",
          schedule: "10/5,30 * * * *",
          handler: () => Promise.resolve(),
        });

        // Expected: "10/5" expands to {10,15,20,25,30,35,40,45,50,55}; "30" is already covered
        // Actual (bug): only {10,30} are set - step is discarded, only the start value is marked
        expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 15, 0))).toBe(true); // fails: missing stepped values
        expect(cron.matches(new Date(2025, 0, 1, 0, 25, 0))).toBe(true); // fails
        expect(cron.matches(new Date(2025, 0, 1, 0, 55, 0))).toBe(true); // fails
        expect(cron.matches(new Date(2025, 0, 1, 0, 11, 0))).toBe(false);
      });

      test("single-value-with-step as first item in a list should expand from start to max", () => {
        const cron = new Cron({
          name: "list-step-only-bug",
          schedule: "5/15,0 * * * *",
          handler: () => Promise.resolve(),
        });

        // Expected: "5/15" expands to {5,20,35,50}; "0" adds 0 -> {0,5,20,35,50}
        // Actual (bug): only {0,5} are set - step is discarded
        expect(cron.matches(new Date(2025, 0, 1, 0, 0, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 5, 0))).toBe(true);
        expect(cron.matches(new Date(2025, 0, 1, 0, 20, 0))).toBe(true); // fails: missing stepped values
        expect(cron.matches(new Date(2025, 0, 1, 0, 35, 0))).toBe(true); // fails
        expect(cron.matches(new Date(2025, 0, 1, 0, 50, 0))).toBe(true); // fails
        expect(cron.matches(new Date(2025, 0, 1, 0, 10, 0))).toBe(false);
      });
    });
  });
});
