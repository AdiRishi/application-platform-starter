import { ArtifactId } from "@repo/contracts/artifacts";
import { ApiRpcs } from "@repo/contracts/artifacts/api";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Schedule, Schema } from "effect";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { expect } from "vitest";

import { Infrastructure } from "../alchemy.run.ts";
import { dataPlane } from "../src/data-plane.ts";

const missingSource = Schema.decodeSync(ArtifactId)("11111111-1111-4111-8111-111111111111");
const interrupted = Schema.decodeSync(ArtifactId)("22222222-2222-4222-8222-222222222222");
const corruptProfile = Schema.decodeSync(ArtifactId)("33333333-3333-4333-8333-333333333333");
const source = "name\nAdi\n";

const Stack = Alchemy.Stack(
  "ApplicationRecoveryTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const data = yield* dataPlane;
    const output = yield* Infrastructure;
    const seed = Alchemy.Action(
      "SeedArtifacts",
      Effect.gen(function* () {
        const db = yield* Cloudflare.D1.QueryDatabase(data.database);
        const bucket = yield* Cloudflare.R2.ReadWriteBucket(data.artifacts);
        return Effect.fn(function* () {
          yield* bucket.put("source.csv", source, { httpMetadata: { contentType: "text/csv" } });
          yield* db.batch([
            db
              .prepare(
                "INSERT INTO artifacts (id,file_name,object_key,content_type,byte_size,status,created_at) VALUES (?, 'missing.csv', 'missing.csv', 'text/csv', 9, 'queued', '2026-08-22T00:00:00Z')",
              )
              .bind(missingSource),
            db
              .prepare(
                "INSERT INTO artifacts (id,file_name,object_key,content_type,byte_size,status,created_at,dispatched_at) VALUES (?, 'processing.csv', 'processing.csv', 'text/csv', 9, 'processing', '2026-08-22T00:00:00Z', '2026-08-22T00:00:00Z')",
              )
              .bind(interrupted),
            db
              .prepare(
                "INSERT INTO artifacts (id,file_name,object_key,content_type,byte_size,status,created_at,completed_at,profile_json) VALUES (?, 'source.csv', 'source.csv', 'text/csv', 9, 'complete', '2026-08-22T00:00:00Z', '2026-08-22T00:00:01Z', '{')",
              )
              .bind(corruptProfile),
          ]);
        });
      }).pipe(
        Effect.provide([Cloudflare.D1.QueryDatabaseLocal, Cloudflare.R2.ReadWriteBucketLocal]),
      ),
    );
    yield* seed(undefined);
    return output;
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
});
const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.flatMap((output) =>
      Effect.gen(function* () {
        const apiUrl = yield* Schema.decodeUnknownEffect(Schema.String)(output.apiUrl);
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy declares its readiness helper error channel as unknown.
        const ready = yield* Test.getWhenReady(`${apiUrl}/health`);
        yield* ready.text;
        return { apiUrl };
      }),
    ),
  ),
);
afterAll(destroy(Stack));

const client = Effect.gen(function* () {
  const { apiUrl } = yield* stack;
  return yield* RpcClient.make(ApiRpcs).pipe(
    Effect.provide(Test.rpcClientLayer(`${apiUrl}/rpc`, { serialization: RpcSerialization.json })),
  );
});

test(
  "a stored processing artifact reads state through native processor RPC",
  Effect.gen(function* () {
    const api = yield* client;
    expect(yield* api.getArtifact({ artifactId: interrupted })).toMatchObject({
      id: interrupted,
      status: "processing",
      rowsProcessed: 0,
      totalRows: 0,
    });
  }).pipe(Effect.scoped),
);

test(
  "invalid stored profiles become safe RPC errors",
  Effect.gen(function* () {
    const api = yield* client;
    expect(yield* api.getArtifact({ artifactId: corruptProfile }).pipe(Effect.flip)).toMatchObject({
      _tag: "ArtifactsUnavailable",
    });
    expect(yield* api.listArtifacts().pipe(Effect.flip)).toMatchObject({
      _tag: "ArtifactsUnavailable",
    });
  }).pipe(Effect.scoped),
);

test(
  "the original source remains downloadable when the stored profile is malformed",
  Effect.gen(function* () {
    const { apiUrl } = yield* stack;
    const response = yield* HttpClient.get(`${apiUrl}/api/artifacts/${corruptProfile}/source`);
    expect(response.status).toBe(200);
    expect(yield* response.text).toBe(source);
  }),
);

test(
  "pending work is recovered by dispatch and a missing source exhausts into the dead-letter consumer",
  Effect.gen(function* () {
    const { apiUrl } = yield* stack;
    const form = new FormData();
    form.set("file", new File([source], "trigger.csv", { type: "text/csv" }));
    const upload = yield* HttpClient.post(`${apiUrl}/api/artifacts`, {
      body: HttpBody.formData(form),
    });
    yield* upload.text;
    expect(upload.status).toBe(202);
    const api = yield* client;
    const artifact = yield* api.getArtifact({ artifactId: missingSource }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("200 millis"),
        until: (artifact) => artifact.status === "failed",
        times: 100,
      }),
    );
    expect(artifact).toMatchObject({
      status: "failed",
      error: "CSV profiling exhausted its retries.",
    });
  }).pipe(Effect.scoped),
  { timeout: 30_000 },
);
