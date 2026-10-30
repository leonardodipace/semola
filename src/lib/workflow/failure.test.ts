import { describe, expect, test } from "bun:test";
import { NonRetryableStepError } from "./errors.js";
import { reviveFailure, toPersistedFailure } from "./failure.js";

class CardDeclinedError extends Error {}

class PaymentError extends Error {
  public constructor(message?: string) {
    super(message);
    this.name = "CardDeclined";
  }
}

describe("workflow failure revive", () => {
  test("toPersistedFailure uses constructor name", () => {
    expect(toPersistedFailure(new CardDeclinedError("declined"))).toEqual({
      message: "declined",
      name: "CardDeclinedError",
    });
  });

  test("toPersistedFailure prefers constructor name over instance name", () => {
    expect(toPersistedFailure(new PaymentError("no funds"))).toEqual({
      message: "no funds",
      name: "PaymentError",
    });
  });

  test("reviveFailure sets Error.name from persisted type", () => {
    const revived = reviveFailure({
      message: "declined",
      name: "CardDeclinedError",
    });

    expect(revived).toBeInstanceOf(Error);
    expect(revived).not.toBeInstanceOf(CardDeclinedError);
    expect(revived.name).toBe("CardDeclinedError");
    expect(revived.message).toBe("declined");
  });

  test("reviveFailure rebuilds NonRetryableStepError by name", () => {
    const revived = reviveFailure({
      message: "stop",
      name: "NonRetryableStepError",
    });

    expect(revived).toBeInstanceOf(NonRetryableStepError);
    expect(revived.message).toBe("stop");
  });

  test("empty message roundtrips", () => {
    const persisted = toPersistedFailure(new CardDeclinedError(""));
    const revived = reviveFailure(persisted);

    expect(persisted.message).toBe("");
    expect(revived.message).toBe("");
    expect(revived.name).toBe("CardDeclinedError");
  });

  test("unicode message roundtrips", () => {
    const message = "declined \u0000 café 卡片拒绝 🃏";
    const revived = reviveFailure(
      toPersistedFailure(new CardDeclinedError(message)),
    );

    expect(revived.message).toBe(message);
    expect(revived.name).toBe("CardDeclinedError");
  });
});
