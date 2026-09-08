import { ArtifactId } from "@repo/contracts/artifacts";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Schema } from "effect";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { expect } from "vitest";

import { ArtifactsBucket, ArtifactsDatabase } from "../src/data-plane.ts";
import ProcessorWorker from "./fixtures/processor-worker.ts";
import { waitForWorker } from "./support/worker-readiness.ts";

const decodeId = Schema.decodeSync(ArtifactId);
const cases = {
  duplicate: decodeId(crypto.randomUUID()),
  source: decodeId(crypto.randomUUID()),
  crypto: decodeId(crypto.randomUUID()),
  progress: decodeId(crypto.randomUUID()),
  interrupted: decodeId(crypto.randomUUID()),
  failed: decodeId(crypto.randomUUID()),
  deleted: decodeId(crypto.randomUUID()),
};
const source = "name,amount\nAdi,42\n";
const Stack = Alchemy.Stack(
  "ProcessorRecoveryTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const database = yield* ArtifactsDatabase;
    const artifacts = yield* ArtifactsBucket;
    const worker = yield* ProcessorWorker;
    const seed = Alchemy.Action(
      "SeedRecovery",
      Effect.gen(function* () {
        const db = yield* Cloudflare.D1.QueryDatabase(database);
        const bucket = yield* Cloudflare.R2.ReadWriteBucket(artifacts);
        return Effect.fn(function* () {
          for (const [name, id] of Object.entries(cases)) {
            if (name === "deleted") continue;
            yield* bucket.put(`source/${id}`, source);
            yield* db
              .prepare(
                "INSERT INTO artifacts (id,file_name,object_key,content_type,byte_size,status,created_at) VALUES (?, 'source.csv', ?, 'text/csv', ?, 'queued', '2026-08-22T00:00:00Z')",
              )
              .bind(id, `source/${id}`, source.length)
              .run();
          }
          yield* db
            .prepare("UPDATE artifacts SET status = 'processing' WHERE id = ?")
            .bind(cases.interrupted)
            .run();
          yield* db
            .prepare(
              "UPDATE artifacts SET status = 'failed', completed_at = '2026-08-22T00:00:01Z', error_message = 'Invalid CSV' WHERE id = ?",
            )
            .bind(cases.failed)
            .run();
        });
      }).pipe(
        Effect.provide([Cloudflare.D1.QueryDatabaseLocal, Cloudflare.R2.ReadWriteBucketLocal]),
      ),
    );
    yield* seed(undefined);
    return { url: worker.url.as<string>() };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
});
const stack = beforeAll(deploy(Stack).pipe(Effect.tap(({ url }) => waitForWorker(`${url}/ready`))));
afterAll(destroy(Stack));

const deliver = Effect.fn(function* (id: ArtifactId, options = "") {
  const { url } = yield* stack;
  const response = yield* HttpClient.post(`${url}/process/${id}${options}`);
  yield* response.text;
  return response.status;
});
const record = Effect.fn(function* (id: ArtifactId) {
  const { url } = yield* stack;
  const response = yield* HttpClient.get(`${url}/record/${id}`);
  expect(response.status).toBe(200);
  return yield* response.json;
});
const removeSource = Effect.fn(function* (id: ArtifactId) {
  const { url } = yield* stack;
  const response = yield* HttpClient.del(`${url}/source/${id}`);
  expect(response.status).toBe(204);
});

test(
  "duplicate delivery and late dead letters preserve a completed result",
  Effect.gen(function* () {
    expect(yield* deliver(cases.duplicate)).toBe(204);
    const completed = yield* record(cases.duplicate);
    expect(completed).toMatchObject({ status: "complete" });
    expect(yield* deliver(cases.duplicate)).toBe(204);
    const { url } = yield* stack;
    const exhausted = yield* HttpClient.post(`${url}/exhaust/${cases.duplicate}`);
    expect(exhausted.status).toBe(204);
    expect(yield* record(cases.duplicate)).toEqual(completed);
  }),
);

test(
  "a source outage can be retried and redelivery completes the job",
  Effect.gen(function* () {
    yield* removeSource(cases.source);
    expect(yield* deliver(cases.source)).toBe(503);
    expect(yield* record(cases.source)).toMatchObject({ status: "processing" });
    const { url } = yield* stack;
    const restored = yield* HttpClient.put(`${url}/source/${cases.source}`, {
      body: HttpBody.text(source),
    });
    expect(restored.status).toBe(204);
    expect(yield* deliver(cases.source)).toBe(204);
    expect(yield* record(cases.source)).toMatchObject({ status: "complete" });
  }),
);

test(
  "a crypto outage can be retried and redelivery completes the job",
  Effect.gen(function* () {
    expect(yield* deliver(cases.crypto, "?failDigest")).toBe(503);
    expect(yield* record(cases.crypto)).toMatchObject({ status: "processing" });
    expect(yield* deliver(cases.crypto)).toBe(204);
    expect(yield* record(cases.crypto)).toMatchObject({ status: "complete" });
  }),
);

test(
  "unavailable progress storage does not prevent a completed profile",
  Effect.gen(function* () {
    expect(yield* deliver(cases.progress, "?failProgress")).toBe(204);
    expect(yield* record(cases.progress)).toMatchObject({ status: "complete" });
  }),
);

test(
  "redelivery resumes an artifact interrupted while processing",
  Effect.gen(function* () {
    expect(yield* record(cases.interrupted)).toMatchObject({ status: "processing" });
    expect(yield* deliver(cases.interrupted)).toBe(204);
    expect(yield* record(cases.interrupted)).toMatchObject({ status: "complete" });
  }),
);

test(
  "redelivery preserves a terminal failure when the source is missing",
  Effect.gen(function* () {
    yield* removeSource(cases.failed);
    const failed = yield* record(cases.failed);
    expect(yield* deliver(cases.failed)).toBe(204);
    expect(yield* record(cases.failed)).toEqual(failed);
  }),
);

test(
  "a deleted artifact finishes without creating a result",
  Effect.gen(function* () {
    expect(yield* deliver(cases.deleted)).toBe(204);
    expect(yield* record(cases.deleted)).toBeNull();
  }),
);

for (const operation of ["process", "exhaust"]) {
  test(
    `invalid messages finish successfully in the ${operation} handler`,
    Effect.gen(function* () {
      const { url } = yield* stack;
      const response = yield* HttpClient.post(`${url}/${operation}/${cases.deleted}?invalid`);
      expect(response.status).toBe(204);
      expect(yield* record(cases.deleted)).toBeNull();
    }),
  );
}
