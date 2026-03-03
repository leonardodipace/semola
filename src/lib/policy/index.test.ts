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
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
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

    expect(policy.can("read", post)).toMatchObject({
      allowed: true,
    });
  });

  test("should deny access when conditions do not match", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
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

    expect(policy.can("read", post)).toMatchObject({
      allowed: false,
    });
  });

  test("should forbid access when forbid conditions match", () => {
    const policy = new Policy<Post>();

    policy.forbid({
      action: "update",
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

    expect(policy.can("update", post)).toMatchObject({
      allowed: false,
    });
  });

  test("should allow access when forbid conditions do not match", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "update",
    });

    policy.forbid({
      action: "update",
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

    expect(policy.can("update", post)).toMatchObject({
      allowed: true,
    });
  });

  test("should work with multiple conditions", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "delete",
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

    expect(policy.can("delete", matchingPost)).toMatchObject({
      allowed: true,
    });
    expect(policy.can("delete", nonMatchingPost1)).toMatchObject({
      allowed: false,
    });
    expect(policy.can("delete", nonMatchingPost2)).toMatchObject({
      allowed: false,
    });
  });

  test("should allow access when no conditions are specified", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
    });

    const post: Post = {
      id: 1,
      title: "Any Post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can("read", post)).toMatchObject({
      allowed: true,
    });
  });

  test("should deny access when no matching rule exists", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
    });

    expect(policy.can("delete")).toMatchObject({ allowed: false });
  });

  test("should handle the example from requirements", () => {
    const post: Post = {
      id: 1,
      title: "Sample Post Title",
      authorId: 1,
      status: "published",
    };

    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
      conditions: {
        status: "published",
      },
    });

    policy.forbid({
      action: "update",
      conditions: {
        status: "published",
      },
    });

    expect(policy.can("read", post)).toMatchObject({
      allowed: true,
    });
    expect(policy.can("update", post)).toMatchObject({
      allowed: false,
    });
  });

  test("should handle multiple rules with different actions", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
      conditions: {
        status: "published",
      },
    });

    policy.allow({
      action: "update",
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

    expect(policy.can("read", publishedPost)).toMatchObject({
      allowed: true,
    });
    expect(policy.can("read", draftPost)).toMatchObject({
      allowed: false,
    });
    expect(policy.can("update", publishedPost)).toMatchObject({
      allowed: false,
    });
    expect(policy.can("update", draftPost)).toMatchObject({
      allowed: true,
    });
  });

  test("should use separate policies per entity type", () => {
    type Comment = { id: number; body: string };

    const postPolicy = new Policy<Post>();
    const commentPolicy = new Policy<Comment>();

    postPolicy.allow({ action: "read" });

    expect(postPolicy.can("read")).toMatchObject({ allowed: true });
    expect(commentPolicy.can("read")).toMatchObject({ allowed: false });
  });

  test("should return reason when forbid rule matches", () => {
    const policy = new Policy<Post>();

    policy.forbid({
      action: "delete",
      reason: "You cannot delete published posts",
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

    const result = policy.can("delete", post);
    expect(result).toMatchObject({
      allowed: false,
      reason: "You cannot delete published posts",
    });
  });

  test("should return reason when allow rule matches", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
      reason: "Public posts are visible to everyone",
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

    const result = policy.can("read", post);
    expect(result).toMatchObject({
      allowed: true,
      reason: "Public posts are visible to everyone",
    });
  });

  test("should return undefined reason when no reason is provided", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
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

    const result = policy.can("read", post);
    expect(result).toMatchObject({ allowed: true });
    expect(result.reason).toBeUndefined();
  });

  test("should return undefined reason when no rule matches", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: "read",
      reason: "Some reason",
    });

    const result = policy.can("delete");
    expect(result).toMatchObject({ allowed: false });
    expect(result.reason).toBeUndefined();
  });

  test("should handle reason with multiple conditions", () => {
    const policy = new Policy<Post>();

    policy.forbid({
      action: "update",
      reason: "Admins cannot update their own published posts",
      conditions: {
        authorId: 1,
        status: "published",
      },
    });

    const post: Post = {
      id: 1,
      title: "Admin's Post",
      authorId: 1,
      status: "published",
    };

    const result = policy.can("update", post);
    expect(result).toMatchObject({
      allowed: false,
      reason: "Admins cannot update their own published posts",
    });
  });

  test("should allow an array of actions in allow()", () => {
    const policy = new Policy<Post>();

    policy.allow({
      action: ["create", "update"],
    });

    const post: Post = {
      id: 1,
      title: "Post",
      authorId: 1,
      status: "draft",
    };

    expect(policy.can("create", post)).toMatchObject({ allowed: true });
    expect(policy.can("update", post)).toMatchObject({ allowed: true });
    expect(policy.can("delete", post)).toMatchObject({ allowed: false });
  });

  test("should allow an array of actions in forbid()", () => {
    const policy = new Policy<Post>();

    policy.allow({ action: "read" });

    policy.forbid({
      action: ["create", "delete"],
    });

    const post: Post = {
      id: 1,
      title: "Post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can("read", post)).toMatchObject({ allowed: true });
    expect(policy.can("create", post)).toMatchObject({ allowed: false });
    expect(policy.can("update", post)).toMatchObject({ allowed: false });
    expect(policy.can("delete", post)).toMatchObject({ allowed: false });
  });
});
