import { ArtifactId, type ProfileJob } from "@repo/contracts/artifacts";
import { applyD1Migrations, createExecutionContext, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { dispatchProfiles } from "../../src/artifacts/dispatch.ts";
import { ArtifactRepository } from "../../src/artifacts/repository.ts";
import { apiRequest } from "../../src/platform/worker-request.ts";

const runDispatch = (queue: Pick<Queue<ProfileJob>, "send">) =>
  Effect.runPromise(
    dispatchProfiles(queue).pipe(
      Effect.provide(ArtifactRepository.layer),
      Effect.provideService(apiRequest.service, {
        env,
        executionContext: createExecutionContext(),
      }),
    ),
  );

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");
const insertPending = () =>
  env.DB.prepare(`INSERT INTO artifacts
  (id, file_name, object_key, content_type, byte_size, status, created_at)
  VALUES (?, 'sample.csv', 'source.csv', 'text/csv', 10, 'queued', '2026-09-07T00:00:00Z')`)
    .bind(artifactId)
    .run();

test("a committed artifact is delivered after an interrupted request or failed queue send", async () => {
  await insertPending();
  await runDispatch({
    send: async () => {
      throw new Error("Queue unavailable");
    },
  });
  expect(await env.DB.prepare("SELECT dispatched_at FROM artifacts").first()).toEqual({
    dispatched_at: null,
  });
  const delivered: ProfileJob[] = [];
  const queue = {
    send: async (job: ProfileJob) => {
      delivered.push(job);
      return env.PROFILE_JOBS.send(job);
    },
  };
  await runDispatch(queue);
  await runDispatch(queue);
  expect(delivered).toEqual([{ artifactId }]);
  expect(await env.DB.prepare("SELECT dispatched_at FROM artifacts").first()).toEqual({
    dispatched_at: expect.any(String),
  });
});

test("an ambiguous queue send may redeliver but never loses pending work", async () => {
  await insertPending();
  const delivered: ProfileJob[] = [];
  await runDispatch({
    send: async (job) => {
      delivered.push(job);
      throw new Error("Reply lost after acceptance");
    },
  });
  await runDispatch({
    send: async (job) => {
      delivered.push(job);
      return env.PROFILE_JOBS.send(job);
    },
  });
  expect(delivered).toEqual([{ artifactId }, { artifactId }]);
});

test("the delivery migration preserves existing artifacts and makes queued work dispatchable", async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 1));
  await insertPending();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const delivered: ProfileJob[] = [];
  await runDispatch({
    send: async (job) => {
      delivered.push(job);
      return env.PROFILE_JOBS.send(job);
    },
  });
  expect(delivered).toEqual([{ artifactId }]);
  expect(await env.DB.prepare("SELECT file_name, status FROM artifacts").first()).toEqual({
    file_name: "sample.csv",
    status: "queued",
  });
});
