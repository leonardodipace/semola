import { describe, expect, test } from "bun:test";
import { createChannelSubscriber } from "./channels.js";

const createConnection = () => {
  const calls: string[] = [];
  let failNext: "subscribe" | "unsubscribe" | null = null;

  const connection = {
    subscribe: async (channel: string) => {
      calls.push(`subscribe:${channel}`);

      if (failNext === "subscribe") {
        failNext = null;
        throw new Error("subscribe failed");
      }
    },
    unsubscribe: async (channel: string) => {
      calls.push(`unsubscribe:${channel}`);

      if (failNext === "unsubscribe") {
        failNext = null;
        throw new Error("unsubscribe failed");
      }
    },
  };

  const fail = (operation: "subscribe" | "unsubscribe") => {
    failNext = operation;
  };

  return { connection, calls, fail };
};

describe("createChannelSubscriber", () => {
  test("routes messages to the listeners of their channel", async () => {
    const { connection } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];

    await subscriber.subscribe("a", (message) => {
      received.push(`a:${message}`);
    });
    await subscriber.subscribe("b", (message) => {
      received.push(`b:${message}`);
    });

    dispatch("a", "1");
    dispatch("b", "2");
    dispatch("c", "3");
    await Bun.sleep(0);

    expect(received).toEqual(["a:1", "b:2"]);
  });

  test("resolves to the number of subscribed channels", async () => {
    const { connection } = createConnection();
    const { subscriber } = createChannelSubscriber(connection);

    expect(await subscriber.subscribe("a", () => {})).toBe(1);
    expect(await subscriber.subscribe("a", () => {})).toBe(1);
    expect(await subscriber.subscribe("b", () => {})).toBe(2);
  });

  test("subscribes on the server once per channel", async () => {
    const { connection, calls } = createConnection();
    const { subscriber } = createChannelSubscriber(connection);
    const first = () => {};
    const second = () => {};

    await subscriber.subscribe("a", first);
    await subscriber.subscribe("a", second);
    await subscriber.unsubscribe("a", first);

    expect(calls).toEqual(["subscribe:a"]);

    await subscriber.unsubscribe("a", second);

    expect(calls).toEqual(["subscribe:a", "unsubscribe:a"]);
  });

  test("removes the listener when the server subscribe fails", async () => {
    const { connection, fail } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];

    fail("subscribe");

    const subscribing = subscriber.subscribe("a", (message) => {
      received.push(message);
    });

    expect(subscribing).rejects.toThrow("subscribe failed");
    await subscribing.catch(() => {});

    dispatch("a", "lost");
    await Bun.sleep(0);

    expect(received).toEqual([]);
  });

  test("keeps the listener when the server unsubscribe fails", async () => {
    const { connection, fail } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    await subscriber.subscribe("a", listener);

    fail("unsubscribe");

    expect(subscriber.unsubscribe("a", listener)).rejects.toThrow(
      "unsubscribe failed",
    );
    await Bun.sleep(0);

    dispatch("a", "still here");
    await Bun.sleep(0);

    expect(received).toEqual(["still here"]);
  });

  test("serializes a subscribe behind an in-flight unsubscribe", async () => {
    const { connection, calls } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];
    const first = () => {};

    await subscriber.subscribe("a", first);

    const leaving = subscriber.unsubscribe("a", first);
    const joining = subscriber.subscribe("a", (message) => {
      received.push(message);
    });

    await Promise.all([leaving, joining]);

    dispatch("a", "after");
    await Bun.sleep(0);

    expect(calls).toEqual(["subscribe:a", "unsubscribe:a", "subscribe:a"]);
    expect(received).toEqual(["after"]);
  });

  test("a throwing listener does not stop its siblings", async () => {
    const { connection } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];

    await subscriber.subscribe("a", () => {
      throw new Error("listener failed");
    });
    await subscriber.subscribe("a", (message) => {
      received.push(message);
    });

    dispatch("a", "hello");
    await Bun.sleep(0);

    expect(received).toEqual(["hello"]);
  });

  test("ignores unsubscribe for an unknown listener", async () => {
    const { connection, calls } = createConnection();
    const { subscriber } = createChannelSubscriber(connection);

    await subscriber.subscribe("a", () => {});
    await subscriber.unsubscribe("a", () => {});
    await subscriber.unsubscribe("b", () => {});

    expect(calls).toEqual(["subscribe:a"]);
  });

  test("concurrent subscribes on a new channel share one server subscribe", async () => {
    const { connection, calls } = createConnection();
    const { subscriber } = createChannelSubscriber(connection);

    const counts = await Promise.all([
      subscriber.subscribe("a", () => {}),
      subscriber.subscribe("a", () => {}),
    ]);

    expect(counts).toEqual([1, 1]);
    expect(calls).toEqual(["subscribe:a"]);
  });

  test("retries the server subscribe after a failed one", async () => {
    const { connection, calls, fail } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];

    fail("subscribe");
    await subscriber.subscribe("a", () => {}).catch(() => {});
    await subscriber.subscribe("a", (message) => {
      received.push(message);
    });

    dispatch("a", "hello");
    await Bun.sleep(0);

    expect(calls).toEqual(["subscribe:a", "subscribe:a"]);
    expect(received).toEqual(["hello"]);
  });

  test("unsubscribe right after subscribe waits for it, then leaves", async () => {
    const { connection, calls } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    const joining = subscriber.subscribe("a", listener);
    const leaving = subscriber.unsubscribe("a", listener);

    await Promise.all([joining, leaving]);

    dispatch("a", "late");
    await Bun.sleep(0);

    expect(calls).toEqual(["subscribe:a", "unsubscribe:a"]);
    expect(received).toEqual([]);
  });

  test("a rejecting listener does not cause an unhandled rejection", async () => {
    const { connection } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    await subscriber.subscribe("a", async () => {
      throw new Error("listener rejected");
    });

    dispatch("a", "hello");
    await Bun.sleep(10);

    process.off("unhandledRejection", onUnhandled);

    expect(unhandled).toEqual([]);
  });

  test("a listener unsubscribing itself does not stop its siblings", async () => {
    const { connection } = createConnection();
    const { subscriber, dispatch } = createChannelSubscriber(connection);
    const received: string[] = [];

    const leaver = async () => {
      await subscriber.unsubscribe("a", leaver);
    };

    await subscriber.subscribe("a", leaver);
    await subscriber.subscribe("a", (message) => {
      received.push(message);
    });

    dispatch("a", "first");
    await Bun.sleep(0);
    dispatch("a", "second");
    await Bun.sleep(0);

    expect(received).toEqual(["first", "second"]);
  });
});
