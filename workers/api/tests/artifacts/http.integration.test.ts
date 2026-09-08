import { ArtifactSummary } from "@repo/contracts/artifacts";
import { createExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

import api from "../../src/index.ts";
import { runSql } from "../support/database.ts";

test("an uploaded CSV is downloadable through the raw HTTP API", async () => {
  const source = "date,description,amount\n2026-08-01,Coffee,-4.80\n";
  const form = new FormData();
  form.set("file", new File([source], "transactions.csv", { type: "text/csv" }));

  const upload = await exports.default.fetch("https://api.test/api/artifacts", {
    body: form,
    method: "POST",
  });
  expect(upload.status).toBe(202);
  const artifact = Schema.decodeUnknownSync(ArtifactSummary)(await upload.json());
  expect(artifact).toMatchObject({
    byteSize: 48,
    contentType: "text/csv",
    fileName: "transactions.csv",
    status: "queued",
  });

  const download = await exports.default.fetch(
    `https://api.test/api/artifacts/${artifact.id}/source`,
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toBe(
    'attachment; filename="transactions.csv"',
  );
  await expect(download.text()).resolves.toBe(source);
});

test("an upload rejects files outside the CSV boundary", async () => {
  const form = new FormData();
  form.set("file", new File(["not csv"], "notes.txt", { type: "text/plain" }));

  const response = await exports.default.fetch("https://api.test/api/artifacts", {
    body: form,
    method: "POST",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toStrictEqual({
    code: "invalid_request",
    message: "Choose a non-empty .csv file of 256 KB or smaller.",
  });
});

test("an upload without Content-Length is bounded before multipart parsing", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(300 * 1024));
      controller.close();
    },
  });
  const response = await exports.default.fetch("https://api.test/api/artifacts", {
    method: "POST",
    body,
    headers: { "content-type": "multipart/form-data; boundary=test" },
  });
  expect(response.status).toBe(400);
});

test("an oversized streaming upload is cancelled before its producer finishes", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await api.fetch(
    new Request("https://api.test/api/artifacts", {
      method: "POST",
      body,
      headers: { "content-type": "multipart/form-data; boundary=test" },
    }),
    env,
    createExecutionContext(),
  );
  expect(response.status).toBe(400);
  expect(cancelled).toBe(true);
});

test("disconnecting an upload cancels a pending body read", async () => {
  const reading = Promise.withResolvers<void>();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        reading.resolve();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const controller = new AbortController();
  const result = api.fetch(
    new Request("https://api.test/api/artifacts", {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { "content-type": "multipart/form-data; boundary=test" },
    }),
    env,
    createExecutionContext(),
  );
  await reading.promise;
  controller.abort();
  expect((await result).status).toBe(499);
  expect(cancelled).toBe(true);
});

test.each([
  { path: "/api/artifacts/not-a-uuid/source", status: 400, code: "invalid_request" },
  {
    path: "/api/artifacts/28f31da1-a2ed-4f1f-a9d9-463107ad09f0/source",
    status: 404,
    code: "not_found",
  },
  { path: "/missing", status: 404, code: "not_found" },
])("HTTP routing preserves the error contract for $path", async ({ path, status, code }) => {
  const response = await exports.default.fetch(`https://api.test${path}`);
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ code });
});

test("the HTTP health route reports the request environment", async () => {
  const response = await exports.default.fetch("https://api.test/health");
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ environment: "test", service: "api" });
});

test("the original CSV remains downloadable when its stored profile is malformed", async () => {
  const artifactId = "28f31da1-a2ed-4f1f-a9d9-463107ad09f0";
  const source = "name\nAdi\n";
  await env.ARTIFACTS.put("source.csv", source, { httpMetadata: { contentType: "text/csv" } });
  await runSql(
    (sql) => sql`
    INSERT INTO artifacts
      (id, file_name, object_key, content_type, byte_size, status, created_at, completed_at, profile_json)
    VALUES (${artifactId}, 'source.csv', 'source.csv', 'text/csv', ${source.length}, 'complete',
            '2026-08-22T00:00:00.000Z', '2026-08-22T00:01:00.000Z', '{')
  `,
  );
  const response = await exports.default.fetch(
    `https://api.test/api/artifacts/${artifactId}/source`,
  );
  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toBe(source);
});
