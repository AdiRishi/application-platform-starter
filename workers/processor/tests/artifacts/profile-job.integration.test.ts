import { ArtifactId } from "@repo/contracts/schema";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

import { handleQueue } from "../../src/artifacts/profile-job.ts";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");
const objectKey = `artifacts/${artifactId}/source.csv`;
const source = new TextEncoder().encode(
  "date,description,amount\n2026-08-01,Coffee,-4.80\n2026-08-02,Salary,4250.00\n",
);

test("a queue job crosses R2, D1, and the profile session", async () => {
  await env.ARTIFACTS.put(objectKey, source);
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
      source.byteLength,
      "2026-08-22T00:00:00.000Z",
    )
    .run();

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
  await expect(session.getState()).resolves.toStrictEqual({ state: { kind: "complete" } });
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

test("a processing failure asks the primary queue to retry", async () => {
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
