import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearWorkflowRegistry,
  listWorkflows,
  recoverOrphanedWorkflows,
  resumeWorkflow,
} from "./index.js";
import {
  createRedis,
  createTwoStepFailResumeWorkflow,
  defineWorkflow,
  type MockRedisClient,
  waitForExecution,
  waitForStatus,
} from "./test-helpers.js";

describe("workflow ops", () => {
  beforeEach(async () => {
    await clearWorkflowRegistry();
  });

  describe("list and registry", () => {
    test("returns empty list when no executions exist", async () => {
      const redis = createRedis();

      defineWorkflow<{ id: number }, string>({
        name: "list-empty",
        redis,
        handler: async () => "ok",
      });

      const listed = await listWorkflows(redis);

      expect(listed).toEqual([]);
    });

    test("lists executions across multiple workflow names", async () => {
      const redis = createRedis();

      const onboard = defineWorkflow<{ id: number }, string>({
        name: "list-onboard",
        redis,
        handler: async () => "ok",
      });

      const provision = defineWorkflow<{ id: number }, string>({
        name: "list-provision",
        redis,
        handler: async () => "ok",
      });

      await onboard.start({ id: 1 }, { executionId: "list-onboard-1" });
      await provision.start({ id: 2 }, { executionId: "list-provision-1" });
      await waitForExecution(onboard, "list-onboard-1");
      await waitForExecution(provision, "list-provision-1");

      const listed = await listWorkflows(redis);
      const names = listed.map((item) => item.name).sort();
      const ids = listed.map((item) => item.id).sort();

      expect(listed.length).toBe(2);
      expect(names).toEqual(["list-onboard", "list-provision"]);
      expect(ids).toEqual(["list-onboard-1", "list-provision-1"]);
    });

    test("filters by name and status", async () => {
      const redis = createRedis();

      const onboard = defineWorkflow<{ id: number }, string>({
        name: "filter-onboard",
        redis,
        handler: async () => "ok",
      });

      const provision = defineWorkflow<{ id: number }, string>({
        name: "filter-provision",
        redis,
        retries: 0,
        handler: async ({ step }) => {
          await step("fail", async () => {
            throw new Error("boom");
          });

          return "ok";
        },
      });

      await onboard.start({ id: 1 }, { executionId: "filter-onboard-1" });
      await provision.start({ id: 2 }, { executionId: "filter-provision-1" });
      await waitForExecution(onboard, "filter-onboard-1");
      await waitForStatus(provision, "filter-provision-1", "failed");

      const byName = await listWorkflows(redis, { name: "filter-onboard" });
      const byStatus = await listWorkflows(redis, { status: "failed" });

      expect(byName.map((item) => item.id)).toEqual(["filter-onboard-1"]);
      expect(byStatus.map((item) => item.id)).toEqual(["filter-provision-1"]);
    });

    test("unlockedOnly excludes locked running executions", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "list-lock",
        redis,
        handler: async () => "ok",
      });

      await workflow.start({ id: 1 }, { executionId: "list-lock-held" });
      await workflow.start({ id: 2 }, { executionId: "list-lock-orphan" });
      await waitForExecution(workflow, "list-lock-held");
      await waitForExecution(workflow, "list-lock-orphan");

      redis.seedHashField(
        "workflow:execution:list-lock-held:meta",
        "status",
        "running",
      );
      redis.seedHashField(
        "workflow:execution:list-lock-orphan:meta",
        "status",
        "running",
      );
      await redis.set(
        "workflow:execution:list-lock-held:lock",
        "token",
        "PX",
        "60000",
      );

      const unlocked = await listWorkflows(redis, {
        status: "running",
        unlockedOnly: true,
      });

      expect(unlocked.map((item) => item.id)).toEqual(["list-lock-orphan"]);
    });

    test("resumeWorkflow resumes by execution id via registry", async () => {
      const redis = createRedis();
      const executedSteps: string[] = [];

      const workflow = createTwoStepFailResumeWorkflow(
        "resume-workflow-api",
        redis,
        executedSteps,
      );

      await workflow.start({ id: 10 }, { executionId: "resume-api-1" });
      await waitForStatus(workflow, "resume-api-1", "failed");

      const pending = await listWorkflows(redis, {
        status: ["pending", "running", "failed"],
        unlockedOnly: true,
      });

      expect(pending.some((item) => item.id === "resume-api-1")).toBe(true);

      const resumed = await resumeWorkflow(redis, "resume-api-1");
      const execution = await waitForStatus(
        workflow,
        "resume-api-1",
        "completed",
      );

      expect(resumed.status).toBe("pending");
      expect(execution.status).toBe("completed");
      expect(executedSteps).toEqual(["step-1:10", "step-2:10", "step-2:10"]);
    });

    test("resumeWorkflow fails when workflow is not registered", async () => {
      const redis = createRedis();

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "resume-unregistered",
        redis,
        handler: async () => "ok",
      });

      await workflow.start({ id: 1 }, { executionId: "resume-unreg-1" });
      await waitForExecution(workflow, "resume-unreg-1");

      await clearWorkflowRegistry();

      await expect(
        resumeWorkflow(redis, "resume-unreg-1"),
      ).rejects.toMatchObject({
        name: "NotFoundError",
        message:
          "Workflow resume-unregistered is not registered in this process",
      });
    });

    test("rejects duplicate workflow name registration", () => {
      const redis = createRedis();

      defineWorkflow<{ id: number }, string>({
        name: "dupe-register",
        redis,
        handler: async () => "ok",
      });

      expect(() => {
        defineWorkflow<{ id: number }, string>({
          name: "dupe-register",
          redis,
          handler: async () => "ok",
        });
      }).toThrow(
        "Workflow dupe-register is already registered in this process",
      );
    });

    test("rejects custom execution id collision across workflow names", async () => {
      const redis = createRedis();

      const first = defineWorkflow<{ id: number }, string>({
        name: "collision-a",
        redis,
        handler: async () => "ok",
      });

      const second = defineWorkflow<{ id: number }, string>({
        name: "collision-b",
        redis,
        handler: async () => "ok",
      });

      await first.start({ id: 1 }, { executionId: "shared-id" });

      await expect(
        second.start({ id: 2 }, { executionId: "shared-id" }),
      ).rejects.toMatchObject({
        name: "StateError",
        message: "Workflow execution shared-id already exists",
      });
    });

    test("get rejects execution owned by another workflow name", async () => {
      const redis = createRedis();

      const first = defineWorkflow<{ id: number }, string>({
        name: "owner-a",
        redis,
        handler: async () => "ok",
      });

      const second = defineWorkflow<{ id: number }, string>({
        name: "owner-b",
        redis,
        handler: async () => "ok",
      });

      await first.start({ id: 1 }, { executionId: "owned-by-a" });
      await waitForExecution(first, "owned-by-a");

      await expect(second.get("owned-by-a")).rejects.toMatchObject({
        name: "NotFoundError",
        message: "Workflow execution owned-by-a not found",
      });
    });
  });

  describe("recovery", () => {
    test("recoverOrphanedWorkflows requeues processing orphans", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "recover-processing",
        redis,
        pollInterval: 1,
        handler: async ({ step }) => {
          await step("work", async () => "ok");
          return "done";
        },
      });

      await workflow.start({ id: 1 }, { executionId: "recover-proc-1" });
      await waitForExecution(workflow, "recover-proc-1");

      redis.seedHashField(
        "workflow:execution:recover-proc-1:meta",
        "status",
        "pending",
      );
      redis.seedHashField(
        "workflow:execution:recover-proc-1:meta",
        "completedAt",
        "",
      );
      redis.seedHashField(
        "workflow:execution:recover-proc-1:meta",
        "result",
        "",
      );
      redis.seedList("workflow:recover-processing:processing", [
        "recover-proc-1",
      ]);

      const recovered = await recoverOrphanedWorkflows(redis, {
        name: "recover-processing",
      });

      expect(recovered).toContain("recover-proc-1");

      const execution = await waitForStatus(
        workflow,
        "recover-proc-1",
        "completed",
      );

      expect(execution.status).toBe("completed");
      expect(redis.getList("workflow:recover-processing:processing")).toEqual(
        [],
      );
    });

    test("recoverOrphanedWorkflows resumes unlocked pending without processing entry", async () => {
      const redis = createRedis() as MockRedisClient & Bun.RedisClient;

      const workflow = defineWorkflow<{ id: number }, string>({
        name: "recover-orphan",
        redis,
        pollInterval: 1,
        handler: async () => "done",
      });

      await workflow.start({ id: 1 }, { executionId: "recover-orphan-1" });
      await waitForExecution(workflow, "recover-orphan-1");

      redis.seedHashField(
        "workflow:execution:recover-orphan-1:meta",
        "status",
        "pending",
      );
      redis.seedHashField(
        "workflow:execution:recover-orphan-1:meta",
        "completedAt",
        "",
      );
      redis.seedHashField(
        "workflow:execution:recover-orphan-1:meta",
        "result",
        "",
      );

      const recovered = await recoverOrphanedWorkflows(redis, {
        name: "recover-orphan",
      });

      expect(recovered).toContain("recover-orphan-1");

      const execution = await waitForStatus(
        workflow,
        "recover-orphan-1",
        "completed",
      );

      expect(execution.status).toBe("completed");
    });
  });
});
