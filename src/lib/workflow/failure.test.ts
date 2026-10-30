import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  NonRetryableStepError,
  SerializationError,
  UnregisteredWorkflowError,
} from "./errors.js";
import {
  createErrorRegistry,
  resolveUnregisteredError,
  reviveFailure,
  toError,
  toPersistedFailure,
} from "./failure.js";

class CardDeclinedError extends Error {}

describe("workflow failure revive", () => {
  const warns: string[] = [];
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    warnSpy?.mockRestore();
    warns.length = 0;
  });

  const captureWarn = () => {
    warnSpy = spyOn(console, "warn").mockImplementation((message: string) => {
      warns.push(message);
    });
  };

  test("toError keeps Error instances and wraps strings", () => {
    const error = new CardDeclinedError("declined");

    expect(toError(error)).toBe(error);
    expect(toError("boom")).toBeInstanceOf(Error);
    expect(toError("boom").message).toBe("boom");
    expect(toError(42).message).toBe("non-Error value thrown");
  });

  test("toPersistedFailure uses constructor name", () => {
    expect(toPersistedFailure(new CardDeclinedError("declined"))).toEqual({
      message: "declined",
      name: "CardDeclinedError",
    });
  });

  test("reviveFailure uses registered constructor", () => {
    const registry = createErrorRegistry([CardDeclinedError]);
    const revived = reviveFailure(
      { message: "declined", name: "CardDeclinedError" },
      registry,
      "warn",
      new Set(),
    );

    expect(revived).toBeInstanceOf(CardDeclinedError);
    expect(revived.message).toBe("declined");
    expect(revived.name).toBe("CardDeclinedError");
  });

  test("reviveFailure rebuilds NonRetryableStepError by default", () => {
    const revived = reviveFailure(
      { message: "stop", name: "NonRetryableStepError" },
      createErrorRegistry(),
      "warn",
      new Set(),
    );

    expect(revived).toBeInstanceOf(NonRetryableStepError);
  });

  test("resolveUnregisteredError warns once per name", () => {
    captureWarn();
    const registry = createErrorRegistry();
    const warned = new Set<string>();

    const first = resolveUnregisteredError(
      new CardDeclinedError("a"),
      registry,
      "warn",
      warned,
    );
    const second = resolveUnregisteredError(
      new CardDeclinedError("b"),
      registry,
      "warn",
      warned,
    );

    expect(first).toBeInstanceOf(CardDeclinedError);
    expect(second).toBeInstanceOf(CardDeclinedError);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("CardDeclinedError");
    expect(warns[0]).toContain("defineWorkflow({ errors })");
  });

  test("resolveUnregisteredError replaces with UnregisteredWorkflowError", () => {
    const resolved = resolveUnregisteredError(
      new CardDeclinedError("a"),
      createErrorRegistry(),
      "error",
      new Set(),
    );

    expect(resolved).toBeInstanceOf(UnregisteredWorkflowError);
    expect(resolved.message).toContain("CardDeclinedError");
  });

  test("resolveUnregisteredError allows listed errors", () => {
    captureWarn();
    const resolved = resolveUnregisteredError(
      new CardDeclinedError("a"),
      createErrorRegistry([CardDeclinedError]),
      "error",
      new Set(),
    );

    expect(resolved).toBeInstanceOf(CardDeclinedError);
    expect(warns).toHaveLength(0);
  });

  test("resolveUnregisteredError allows plain Error", () => {
    captureWarn();
    const resolved = resolveUnregisteredError(
      new Error("plain"),
      createErrorRegistry(),
      "error",
      new Set(),
    );

    expect(resolved).toBeInstanceOf(Error);
    expect(resolved).not.toBeInstanceOf(UnregisteredWorkflowError);
    expect(warns).toHaveLength(0);
  });

  test("reviveFailure warns for unknown name", () => {
    captureWarn();
    const revived = reviveFailure(
      { message: "declined", name: "CardDeclinedError" },
      createErrorRegistry(),
      "warn",
      new Set(),
    );

    expect(revived).toBeInstanceOf(Error);
    expect(revived).not.toBeInstanceOf(CardDeclinedError);
    expect(revived.name).toBe("CardDeclinedError");
    expect(warns).toHaveLength(1);
  });

  test("reviveFailure returns UnregisteredWorkflowError for unknown name when mode is error", () => {
    const revived = reviveFailure(
      { message: "declined", name: "CardDeclinedError" },
      createErrorRegistry(),
      "error",
      new Set(),
    );

    expect(revived).toBeInstanceOf(UnregisteredWorkflowError);
    expect(revived.message).toContain("CardDeclinedError");
  });

  describe("adversarial durable error identity", () => {
    test("toPersistedFailure prefers constructor.name over mutated .name", () => {
      const error = new CardDeclinedError("x");
      error.name = "RenamedSurface";

      expect(toPersistedFailure(error)).toEqual({
        message: "x",
        name: "CardDeclinedError",
      });
    });

    test("toPersistedFailure uses anonymous class constructor.name", () => {
      const Anon = class extends Error {};
      const persisted = toPersistedFailure(new Anon("anon"));

      expect(persisted.message).toBe("anon");
      expect(persisted.name).toBe(Anon.name);
    });

    test("toPersistedFailure records TypeError and AggregateError names", () => {
      expect(toPersistedFailure(new TypeError("bad type"))).toEqual({
        message: "bad type",
        name: "TypeError",
      });
      expect(
        toPersistedFailure(new AggregateError([new Error("a")], "many")),
      ).toEqual({
        message: "many",
        name: "AggregateError",
      });
    });

    test("createErrorRegistry always includes platform classes", () => {
      const registry = createErrorRegistry();

      expect(
        reviveFailure(
          { message: "nr", name: "NonRetryableStepError" },
          registry,
          "error",
          new Set(),
        ),
      ).toBeInstanceOf(NonRetryableStepError);

      expect(
        reviveFailure(
          { message: "ser", name: "SerializationError" },
          registry,
          "error",
          new Set(),
        ),
      ).toBeInstanceOf(SerializationError);

      expect(
        reviveFailure(
          { message: "unreg", name: "UnregisteredWorkflowError" },
          registry,
          "error",
          new Set(),
        ),
      ).toBeInstanceOf(UnregisteredWorkflowError);
    });

    test("createErrorRegistry duplicate entries still revive", () => {
      const registry = createErrorRegistry([
        CardDeclinedError,
        CardDeclinedError,
      ]);
      const revived = reviveFailure(
        { message: "dup", name: "CardDeclinedError" },
        registry,
        "error",
        new Set(),
      );

      expect(revived).toBeInstanceOf(CardDeclinedError);
      expect(revived.message).toBe("dup");
    });

    test("createErrorRegistry same constructor.name last entry wins", () => {
      class PaymentError extends Error {
        public readonly tag = "first";
      }

      const SecondPaymentError = class PaymentError extends Error {
        public readonly tag = "second";
      };

      const registry = createErrorRegistry([PaymentError, SecondPaymentError]);
      const revived = reviveFailure(
        { message: "pay", name: "PaymentError" },
        registry,
        "warn",
        new Set(),
      );

      expect(revived).toBeInstanceOf(SecondPaymentError);
      expect((revived as InstanceType<typeof SecondPaymentError>).tag).toBe(
        "second",
      );
    });

    test("reviveFailure empty unicode and long messages", () => {
      const registry = createErrorRegistry([CardDeclinedError]);
      const unicode = "拒绝 💥";
      const long = "y".repeat(12_000);

      expect(
        reviveFailure(
          { message: "", name: "CardDeclinedError" },
          registry,
          "warn",
          new Set(),
        ).message,
      ).toBe("");

      expect(
        reviveFailure(
          { message: unicode, name: "CardDeclinedError" },
          registry,
          "warn",
          new Set(),
        ).message,
      ).toBe(unicode);

      expect(
        reviveFailure(
          { message: long, name: "CardDeclinedError" },
          registry,
          "warn",
          new Set(),
        ).message,
      ).toBe(long);
    });

    test("reviveFailure rebuilds built-in TypeError without listing", () => {
      const revived = reviveFailure(
        { message: "typed", name: "TypeError" },
        createErrorRegistry(),
        "error",
        new Set(),
      );

      expect(revived).toBeInstanceOf(TypeError);
      expect(revived.message).toBe("typed");
    });

    test("resolveUnregisteredError allows built-in TypeError without listing", () => {
      captureWarn();
      const resolved = resolveUnregisteredError(
        new TypeError("bad type"),
        createErrorRegistry(),
        "error",
        new Set(),
      );

      expect(resolved).toBeInstanceOf(TypeError);
      expect(warns).toHaveLength(0);
    });

    test("reviveFailure falls back for AggregateError name (not message-ctor shaped)", () => {
      captureWarn();
      const revived = reviveFailure(
        { message: "agg", name: "AggregateError" },
        createErrorRegistry(),
        "error",
        new Set(),
      );

      expect(revived).toBeInstanceOf(Error);
      expect(revived).not.toBeInstanceOf(AggregateError);
      expect(revived.message).toBe("agg");
      expect(revived.name).toBe("AggregateError");
      expect(warns).toHaveLength(0);
    });

    test("reviveFailure warns once per unknown name with shared set", () => {
      captureWarn();
      const warned = new Set<string>();
      const registry = createErrorRegistry();

      reviveFailure(
        { message: "a", name: "GhostError" },
        registry,
        "warn",
        warned,
      );
      reviveFailure(
        { message: "b", name: "GhostError" },
        registry,
        "warn",
        warned,
      );
      reviveFailure(
        { message: "c", name: "OtherGhostError" },
        registry,
        "warn",
        warned,
      );

      expect(warns).toHaveLength(2);
      expect(warns[0]).toContain("GhostError");
      expect(warns[1]).toContain("OtherGhostError");
    });

    test("reviveFailure with empty durable name under warn", () => {
      const revived = reviveFailure(
        { message: "blank-name", name: "" },
        createErrorRegistry(),
        "warn",
        new Set(),
      );

      expect(revived).toBeInstanceOf(Error);
      expect(revived.message).toBe("blank-name");
    });

    test("reviveFailure falls back when registered constructor throws", () => {
      class ExplodingError extends Error {
        public constructor(message?: string) {
          super(message);
          throw new RangeError("ctor refused");
        }
      }

      const revived = reviveFailure(
        { message: "boom", name: "ExplodingError" },
        createErrorRegistry([ExplodingError]),
        "warn",
        new Set(),
      );

      expect(revived).toBeInstanceOf(Error);
      expect(revived).not.toBeInstanceOf(ExplodingError);
      expect(revived.message).toBe("boom");
      expect(revived.name).toBe("ExplodingError");
    });

    test("resolveUnregisteredError allows platform classes without listing", () => {
      captureWarn();
      const registry = createErrorRegistry();

      expect(
        resolveUnregisteredError(
          new NonRetryableStepError("stop"),
          registry,
          "error",
          new Set(),
        ),
      ).toBeInstanceOf(NonRetryableStepError);

      expect(
        resolveUnregisteredError(
          new SerializationError("bad json"),
          registry,
          "error",
          new Set(),
        ),
      ).toBeInstanceOf(SerializationError);

      expect(warns).toHaveLength(0);
    });

    test("resolveUnregisteredError warns separately for distinct class names", () => {
      captureWarn();
      class AlphaError extends Error {}
      class BetaError extends Error {}
      const warned = new Set<string>();
      const registry = createErrorRegistry();

      resolveUnregisteredError(new AlphaError("a"), registry, "warn", warned);
      resolveUnregisteredError(new BetaError("b"), registry, "warn", warned);
      resolveUnregisteredError(new AlphaError("a2"), registry, "warn", warned);

      expect(warns).toHaveLength(2);
    });

    test("resolveUnregisteredError does not warn under error mode", () => {
      captureWarn();
      resolveUnregisteredError(
        new CardDeclinedError("a"),
        createErrorRegistry(),
        "error",
        new Set(),
      );

      expect(warns).toHaveLength(0);
    });
  });
});
