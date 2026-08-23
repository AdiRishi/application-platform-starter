import { ArtifactId } from "@repo/contracts";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { Schema } from "effect";
import { beforeEach, expect, inject, test } from "vitest";

import processor from "../src/index.ts";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");
const objectKey = `artifacts/${artifactId}/source.csv`;
const source = new TextEncoder().encode(
  "date,description,amount\n2026-08-01,Coffee,-4.80\n2026-08-02,Salary,4250.00\n",
);

beforeEach(async () => {
  await applyD1Migrations(env.DB, [...inject("migrations")]);
});

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
  await processor.queue(batch, env);
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

  const response = await processor.fetch(
    new Request(`https://processor.test/artifacts/${artifactId}/progress`),
    env,
  );
  await expect(response.json()).resolves.toStrictEqual({ artifactId, kind: "complete" });
});
