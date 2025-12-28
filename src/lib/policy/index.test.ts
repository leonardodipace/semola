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

    policy.allow<Post>({
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

    expect(policy.can<Post>("read", "Post", post)).toMatchObject({
      allowed: true,
    });
  });

  test("should deny access when conditions do not match", () => {
    const policy = new Policy();

    policy.allow<Post>({
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

    expect(policy.can<Post>("read", "Post", post)).toMatchObject({
      allowed: false,
    });
  });

  test("should forbid access when forbid conditions match", () => {
    const policy = new Policy();

    policy.forbid<Post>({
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

    expect(policy.can<Post>("update", "Post", post)).toMatchObject({
      allowed: false,
    });
  });

  test("should allow access when forbid conditions do not match", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "update",
      entity: "Post",
    });

    policy.forbid<Post>({
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

    expect(policy.can<Post>("update", "Post", post)).toMatchObject({
      allowed: true,
    });
  });

  test("should work with multiple conditions", () => {
    const policy = new Policy();

    policy.allow<Post>({
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

    expect(policy.can<Post>("delete", "Post", matchingPost)).toMatchObject({
      allowed: true,
    });
    expect(policy.can<Post>("delete", "Post", nonMatchingPost1)).toMatchObject({
      allowed: false,
    });
    expect(policy.can<Post>("delete", "Post", nonMatchingPost2)).toMatchObject({
      allowed: false,
    });
  });

  test("should allow access when no conditions are specified", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
      entity: "Post",
    });

    const post: Post = {
      id: 1,
      title: "Any Post",
      authorId: 1,
      status: "published",
    };

    expect(policy.can<Post>("read", "Post", post)).toMatchObject({
      allowed: true,
    });
  });

  test("should deny access when no matching rule exists", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
      entity: "Post",
    });

    expect(policy.can("delete", "Post")).toMatchObject({ allowed: false });
  });

  test("should handle the example from requirements", () => {
    const post: Post = {
      id: 1,
      title: "Sample Post Title",
      authorId: 1,
      status: "published",
    };

    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    policy.forbid<Post>({
      action: "update",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    expect(policy.can<Post>("read", "Post", post)).toMatchObject({
      allowed: true,
    });
    expect(policy.can<Post>("update", "Post", post)).toMatchObject({
      allowed: false,
    });
  });

  test("should handle multiple rules with different actions", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
      entity: "Post",
      conditions: {
        status: "published",
      },
    });

    policy.allow<Post>({
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

    expect(policy.can<Post>("read", "Post", publishedPost)).toMatchObject({
      allowed: true,
    });
    expect(policy.can<Post>("read", "Post", draftPost)).toMatchObject({
      allowed: false,
    });
    expect(policy.can<Post>("update", "Post", publishedPost)).toMatchObject({
      allowed: false,
    });
    expect(policy.can<Post>("update", "Post", draftPost)).toMatchObject({
      allowed: true,
    });
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

    expect(policy.can("read", "Post")).toMatchObject({ allowed: true });
    expect(policy.can("read", "Comment")).toMatchObject({ allowed: true });
    expect(policy.can("read", "User")).toMatchObject({ allowed: false });
  });

  test("should return reason when forbid rule matches", () => {
    const policy = new Policy();

    policy.forbid<Post>({
      action: "delete",
      entity: "Post",
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

    const result = policy.can<Post>("delete", "Post", post);
    expect(result).toMatchObject({
      allowed: false,
      reason: "You cannot delete published posts",
    });
  });

  test("should return reason when allow rule matches", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
      entity: "Post",
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

    const result = policy.can<Post>("read", "Post", post);
    expect(result).toMatchObject({
      allowed: true,
      reason: "Public posts are visible to everyone",
    });
  });

  test("should return undefined reason when no reason is provided", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
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

    const result = policy.can<Post>("read", "Post", post);
    expect(result).toMatchObject({ allowed: true });
    expect(result.reason).toBeUndefined();
  });

  test("should return undefined reason when no rule matches", () => {
    const policy = new Policy();

    policy.allow<Post>({
      action: "read",
      entity: "Post",
      reason: "Some reason",
    });

    const result = policy.can("delete", "Post");
    expect(result).toMatchObject({ allowed: false });
    expect(result.reason).toBeUndefined();
  });

  test("should handle reason with multiple conditions", () => {
    const policy = new Policy();

    policy.forbid<Post>({
      action: "update",
      entity: "Post",
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

    const result = policy.can<Post>("update", "Post", post);
    expect(result).toMatchObject({
      allowed: false,
      reason: "Admins cannot update their own published posts",
    });
  });
});
