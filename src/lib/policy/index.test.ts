import { describe, expect, test } from "bun:test";
import { Policy } from "./index.js";

type Post = {
  id: number;
  title: string;
  authorId: number;
  status: string;
};

describe("Policy", () => {
  test("should allow access when conditions match", () => {
    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    const post: Post = {
      id: 1,
      title: "Sample Post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can("read", "Post", post)).toBe(true);
  });

  test("should deny access when conditions do not match", () => {
    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    const post: Post = {
      id: 1,
      title: "Draft Post",
      authorId: 1,
      status: "draft",
    };

    expect(policy.can("read", "Post", post)).toBe(false);
  });

  test("should forbid access when forbid conditions match", () => {
    const policy = new Policy();

    policy.forbid({
      action: "update",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    const post: Post = {
      id: 1,
      title: "Published Post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can("update", "Post", post)).toBe(false);
  });

  test("should allow access when forbid conditions do not match", () => {
    const policy = new Policy();

    policy.allow({
      action: "update",
      entity: "Post",
    });

    policy.forbid({
      action: "update",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    const post: Post = {
      id: 1,
      title: "Draft Post",
      authorId: 1,
      status: "draft",
    };

    expect(policy.can("update", "Post", post)).toBe(true);
  });

  test("should work with multiple conditions", () => {
    const policy = new Policy();

    policy.allow({
      action: "delete",
      entity: "Post",
      conditions: {
        authorId: 1,
        status: "draft",
      },
    });

    const matchingPost: Post = {
      id: 1,
      title: "My Draft",
      authorId: 1,
      status: "draft",
    };

    const nonMatchingPost1: Post = {
      id: 2,
      title: "Someone else's draft",
      authorId: 2,
      status: "draft",
    };

    const nonMatchingPost2: Post = {
      id: 3,
      title: "My published post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can("delete", "Post", matchingPost)).toBe(true);
    expect(policy.can("delete", "Post", nonMatchingPost1)).toBe(false);
    expect(policy.can("delete", "Post", nonMatchingPost2)).toBe(false);
  });

  test("should allow access when no conditions are specified", () => {
    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
    });

    const post: Post = {
      id: 1,
      title: "Any Post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can("read", "Post", post)).toBe(true);
  });

  test("should deny access when no matching rule exists", () => {
    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
    });

    expect(policy.can("delete", "Post")).toBe(false);
  });

  test("should handle the example from requirements", () => {
    const post: Post = {
      id: 1,
      title: "Sample Post Title",
      authorId: 1,
      status: "published",
    };

    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    policy.forbid({
      action: "update",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    expect(policy.can("read", "Post", post)).toBe(true);
    expect(policy.can("update", "Post", post)).toBe(false);
  });

  test("should handle multiple rules with different actions", () => {
    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    policy.allow({
      action: "update",
      entity: "Post",
      conditions: {
        status: "draft",
      },
    });

    const publishedPost: Post = {
      id: 1,
      title: "Published",
      authorId: 1,
      status: "published",
    };

    const draftPost: Post = {
      id: 2,
      title: "Draft",
      authorId: 1,
      status: "draft",
    };

    expect(policy.can("read", "Post", publishedPost)).toBe(true);
    expect(policy.can("read", "Post", draftPost)).toBe(false);
    expect(policy.can("update", "Post", publishedPost)).toBe(false);
    expect(policy.can("update", "Post", draftPost)).toBe(true);
  });

  test("should handle different entities", () => {
    const policy = new Policy();

    policy.allow({
      action: "read",
      entity: "Post",
    });

    policy.allow({
      action: "read",
      entity: "Comment",
    });

    expect(policy.can("read", "Post")).toBe(true);
    expect(policy.can("read", "Comment")).toBe(true);
    expect(policy.can("read", "User")).toBe(false);
  });
});
