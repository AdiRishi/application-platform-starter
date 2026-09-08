import { ArtifactId } from "@repo/contracts/artifacts";
import { Schema } from "effect";
import { expect } from "vitest";

import { test, type Runtime } from "../support/runtime.ts";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");
const objectKey = `artifacts/${artifactId}/source.csv`;
const source = new TextEncoder().encode(
  "date,description,amount\n2026-08-01,Coffee,-4.80\n2026-08-02,Salary,4250.00\n",
);

const seedArtifact = async (runtime: Runtime, bytes = source) => {
  await runtime.artifacts.put(objectKey, bytes);
  await runtime.database
    .prepare(`INSERT INTO artifacts
    (id, file_name, object_key, content_type, byte_size, status, created_at)
    VALUES (?, 'transactions.csv', ?, 'text/csv', ?, 'queued', '2026-08-22T00:00:00.000Z')`)
    .bind(artifactId, objectKey, bytes.byteLength)
    .run();
};
const deliver = (runtime: Runtime, queue = "profile-jobs", failDigest = false) =>
  runtime.deliver({ queue, body: { artifactId }, failDigest });
const record = (runtime: Runtime) =>
  runtime.database
    .prepare("SELECT status, profile_json, completed_at, error_message FROM artifacts WHERE id = ?")
    .bind(artifactId)
    .first();

test("a queue job crosses R2, D1, and the profile session", async ({ runtime }) => {
  await seedArtifact(runtime);
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  const row = await record(runtime);
  expect(row).toMatchObject({ status: "complete" });
  const profile = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
    row?.profile_json,
  );
  expect(profile).toMatchObject({ malformedRows: 0, rowCount: 2 });
  expect(await runtime.session(artifactId).getState()).toMatchObject({
    state: { kind: "processing", rowsProcessed: 2, totalRows: 2 },
  });
});

for (const queue of ["profile-jobs", "profile-jobs-dlq"]) {
  test(`an invalid message on ${queue} is acknowledged instead of retried`, async ({ runtime }) => {
    expect(await runtime.deliver({ queue, body: { artifactId: "not-an-artifact-id" } })).toEqual({
      acks: ["delivery"],
      retries: [],
    });
  });
}

test("a missing source asks the primary queue to retry", async ({ runtime }) => {
  await seedArtifact(runtime);
  await runtime.artifacts.delete(objectKey);
  expect(await deliver(runtime)).toEqual({ acks: [], retries: ["delivery"] });
  await runtime.artifacts.put(objectKey, source);
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  expect(await record(runtime)).toMatchObject({ status: "complete" });
});

test("duplicate delivery and late dead letters preserve a completed result", async ({
  runtime,
}) => {
  await seedArtifact(runtime);
  await deliver(runtime);
  const completed = await record(runtime);
  expect(completed).toMatchObject({ status: "complete" });
  await deliver(runtime);
  await deliver(runtime, "profile-jobs-dlq");
  expect(await record(runtime)).toEqual(completed);
});

test("malformed CSV becomes a terminal failure without retrying", async ({ runtime }) => {
  await seedArtifact(runtime, new TextEncoder().encode('name\n"unterminated'));
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  expect(await record(runtime)).toMatchObject({ status: "failed" });
});

test("unavailable progress storage does not fail a completed profile", async ({ runtime }) => {
  await seedArtifact(runtime);
  await runtime.session(artifactId).getState();
  const storage = await runtime.miniflare.unsafeGetDurableObjectStorage(
    "processor-test",
    "CsvProfileSession",
    { name: artifactId },
  );
  await storage.exec("DROP TABLE profile_progress");
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  expect(await record(runtime)).toMatchObject({ status: "complete" });
});

test("a retry resumes an artifact interrupted while processing", async ({ runtime }) => {
  await seedArtifact(runtime);
  await runtime.database
    .prepare("UPDATE artifacts SET status = 'processing' WHERE id = ?")
    .bind(artifactId)
    .run();
  await runtime.session(artifactId).progress(1, 2);
  await deliver(runtime);
  expect(await record(runtime)).toMatchObject({ status: "complete" });
});

test("a crypto outage retries the job and redelivery completes it", async ({ runtime }) => {
  await seedArtifact(runtime);
  expect(await deliver(runtime, "profile-jobs", true)).toEqual({ acks: [], retries: ["delivery"] });
  expect(await record(runtime)).toMatchObject({ status: "processing" });
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  expect(await record(runtime)).toMatchObject({ status: "complete" });
});

test("redelivery preserves a failed artifact even when its source is unavailable", async ({
  runtime,
}) => {
  await seedArtifact(runtime);
  await runtime.database
    .prepare(
      "UPDATE artifacts SET status = 'failed', error_message = 'Invalid CSV', completed_at = '2026-08-22T00:00:01.000Z' WHERE id = ?",
    )
    .bind(artifactId)
    .run();
  await runtime.artifacts.delete(objectKey);
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  expect(await record(runtime)).toMatchObject({ status: "failed", error_message: "Invalid CSV" });
});

test("a deleted artifact is acknowledged without creating a result", async ({ runtime }) => {
  expect(await deliver(runtime)).toEqual({ acks: ["delivery"], retries: [] });
  expect(await record(runtime)).toBeNull();
});

test("real queue delivery exhausts a missing source into the dead-letter consumer", async ({
  runtime,
}) => {
  await seedArtifact(runtime);
  await runtime.artifacts.delete(objectKey);
  await runtime.jobs.send({ artifactId });
  await expect
    .poll(() => record(runtime), { timeout: 10_000 })
    .toMatchObject({
      status: "failed",
      error_message: "CSV profiling exhausted its retries.",
    });
});
