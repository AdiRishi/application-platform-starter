import { ArtifactId } from "@repo/contracts/artifacts";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

import { handleQueue } from "../../src/artifacts/profile-job.ts";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");
const objectKey = `artifacts/${artifactId}/source.csv`;
const source = new TextEncoder().encode(
  "date,description,amount\n2026-08-01,Coffee,-4.80\n2026-08-02,Salary,4250.00\n",
);

const seedArtifact = async (bytes = source) => {
  await env.ARTIFACTS.put(objectKey, bytes);
  await env.DB.prepare(
    `INSERT INTO artifacts
      (id, file_name, object_key, content_type, byte_size, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  )
    .bind(
      artifactId,
      "transactions.csv",
      objectKey,
      "text/csv",
      bytes.byteLength,
      "2026-08-22T00:00:00.000Z",
    )
    .run();
};

const deliver = async (queue = "profile-jobs") => {
  const batch = createMessageBatch(queue, [
    { attempts: 1, body: { artifactId }, id: "redelivery", timestamp: new Date() },
  ]);
  const context = createExecutionContext();
  await handleQueue(batch, env, context);
  return getQueueResult(batch, context);
};

test("a queue job crosses R2, D1, and the profile session", async () => {
  await seedArtifact();

  const batch = createMessageBatch("profile-jobs", [
    {
      attempts: 1,
      body: { artifactId },
      id: "job-1",
      timestamp: new Date("2026-08-22T00:00:01.000Z"),
    },
  ]);
  const context = createExecutionContext();
  await handleQueue(batch, env, context);
  const result = await getQueueResult(batch, context);

  expect(result.ackAll).toBe(false);
  expect(result.explicitAcks).toStrictEqual(["job-1"]);
  expect(result.retryBatch).toStrictEqual({ retry: false });

  const row = await env.DB.prepare("SELECT status, profile_json FROM artifacts WHERE id = ?")
    .bind(artifactId)
    .first<{ profile_json: string; status: string }>();
  expect(row?.status).toBe("complete");
  expect(JSON.parse(row?.profile_json ?? "null")).toMatchObject({
    malformedRows: 0,
    rowCount: 2,
  });

  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await expect(session.getState()).resolves.toStrictEqual({
    state: { kind: "processing", rowsProcessed: 2, totalRows: 2 },
  });
});

test.each(["profile-jobs", "profile-jobs-dlq"])(
  "an invalid message on %s is acknowledged instead of retried",
  async (queueName) => {
    const batch = createMessageBatch(queueName, [
      {
        attempts: 1,
        body: { artifactId: "not-an-artifact-id" },
        id: "invalid-job",
        timestamp: new Date("2026-08-22T00:00:01.000Z"),
      },
    ]);
    const context = createExecutionContext();

    await handleQueue(batch, env, context);
    const result = await getQueueResult(batch, context);

    expect(result.explicitAcks).toStrictEqual(["invalid-job"]);
    expect(result.retryMessages).toStrictEqual([]);
  },
);

test("a missing source asks the primary queue to retry", async () => {
  await seedArtifact();
  await env.ARTIFACTS.delete(objectKey);
  const batch = createMessageBatch("profile-jobs", [
    {
      attempts: 1,
      body: { artifactId },
      id: "missing-artifact",
      timestamp: new Date("2026-08-22T00:00:01.000Z"),
    },
  ]);
  const context = createExecutionContext();

  await handleQueue(batch, env, context);
  const result = await getQueueResult(batch, context);

  expect(result.explicitAcks).toStrictEqual([]);
  expect(result.retryMessages).toStrictEqual([{ msgId: "missing-artifact" }]);
});

test("duplicate delivery and late dead letters preserve a completed result", async () => {
  await seedArtifact();
  await deliver();
  const result = await env.DB.prepare(
    "SELECT status, profile_json, completed_at FROM artifacts WHERE id = ?",
  )
    .bind(artifactId)
    .first();
  await deliver();
  await deliver("profile-jobs-dlq");
  expect(
    await env.DB.prepare("SELECT status, profile_json, completed_at FROM artifacts WHERE id = ?")
      .bind(artifactId)
      .first(),
  ).toEqual(result);
});

test("malformed CSV becomes a terminal failure without retrying", async () => {
  await seedArtifact(new TextEncoder().encode('name\n"unterminated'));
  const delivery = await deliver();
  expect(delivery.explicitAcks).toEqual(["redelivery"]);
  expect(delivery.retryMessages).toEqual([]);
  expect(
    await env.DB.prepare("SELECT status FROM artifacts WHERE id = ?").bind(artifactId).first(),
  ).toEqual({ status: "failed" });
});

test("unavailable progress storage does not fail a completed profile", async () => {
  await seedArtifact();
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await session.getState();
  await runInDurableObject(session, (_instance, state) => {
    state.storage.sql.exec("DROP TABLE profile_progress");
  });
  const delivery = await deliver();
  expect(delivery.explicitAcks).toEqual(["redelivery"]);
  expect(
    await env.DB.prepare("SELECT status FROM artifacts WHERE id = ?").bind(artifactId).first(),
  ).toEqual({ status: "complete" });
});

test("a retry resumes an artifact interrupted while processing", async () => {
  await seedArtifact();
  await env.DB.prepare("UPDATE artifacts SET status = 'processing' WHERE id = ?")
    .bind(artifactId)
    .run();
  await env.PROFILE_SESSIONS.getByName(artifactId).progress(1, 2);
  await deliver();
  expect(
    await env.DB.prepare("SELECT status FROM artifacts WHERE id = ?").bind(artifactId).first(),
  ).toEqual({ status: "complete" });
});
