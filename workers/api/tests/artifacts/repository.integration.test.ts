import { ArtifactId } from "@repo/contracts/artifacts";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { ArtifactRepository } from "../../src/artifacts/repository.ts";
import { apiRequest } from "../../src/platform/worker-request.ts";
import { runSql } from "../support/database.ts";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");
const runRepository = <A, E>(effect: Effect.Effect<A, E, ArtifactRepository>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(ArtifactRepository.layer),
      Effect.provideService(apiRequest.service, {
        env,
        executionContext: createExecutionContext(),
      }),
    ),
  );

test("artifact metadata containing quotes survives insertion and retrieval", async () => {
  const row = await runRepository(
    ArtifactRepository.use((repository) =>
      Effect.gen(function* () {
        yield* repository.insert({
          id: artifactId,
          fileName: "Adi's 'transactions'.csv",
          objectKey: "artifacts/quoted's/source.csv",
          contentType: "text/csv",
          byteSize: 48,
          createdAt: "2026-08-22T00:00:00.000Z",
        });
        return yield* repository.get(artifactId);
      }),
    ),
  );
  expect(row).toEqual({
    id: artifactId,
    file_name: "Adi's 'transactions'.csv",
    object_key: "artifacts/quoted's/source.csv",
    content_type: "text/csv",
    byte_size: 48,
    created_at: "2026-08-22T00:00:00.000Z",
    completed_at: null,
    error_message: null,
    profile_json: null,
    status: "queued",
  });
});

test("a missing artifact produces the domain not-found error", async () => {
  const error = await runRepository(
    ArtifactRepository.use((repository) => repository.get(artifactId)).pipe(Effect.flip),
  );
  expect(error).toMatchObject({ _tag: "ArtifactNotFound", artifactId });
});

test("a database failure stays in the repository's typed error channel", async () => {
  await runSql((sql) => sql`DROP TABLE artifacts`);
  const error = await runRepository(
    ArtifactRepository.use((repository) => repository.list).pipe(Effect.flip),
  );
  expect(error).toMatchObject({ _tag: "StorageFailure", operation: "list artifacts" });
});

const profile = {
  columns: [],
  malformedRows: 0,
  preview: [],
  rowCount: 0,
  sha256: "0".repeat(64),
};

test("completed artifacts expose a decoded profile through both repository reads", async () => {
  await runSql(
    (sql) => sql`INSERT INTO artifacts
      (id, file_name, object_key, content_type, byte_size, status, created_at, completed_at, profile_json)
      VALUES (${artifactId}, 'empty.csv', 'source.csv', 'text/csv', 4, 'complete',
              '2026-08-22T00:00:00.000Z', '2026-08-22T00:01:00.000Z', ${JSON.stringify(profile)})`,
  );
  const result = await runRepository(
    ArtifactRepository.use((repository) =>
      Effect.all({ detail: repository.get(artifactId), list: repository.list }),
    ),
  );
  expect(result.detail).toMatchObject({ status: "complete", profile_json: profile });
  expect(result.list).toEqual([result.detail]);
});

test.each([
  { status: "complete", completedAt: "2026-08-22", profileJson: "{", error: null },
  { status: "complete", completedAt: "2026-08-22", profileJson: "{}", error: null },
])("invalid stored state stays in the typed error channel: %j", async (record) => {
  await runSql(
    (sql) => sql`INSERT INTO artifacts
      (id, file_name, object_key, content_type, byte_size, status, created_at,
       completed_at, profile_json, error_message)
      VALUES (${artifactId}, 'data.csv', 'source.csv', 'text/csv', 4, ${record.status},
              '2026-08-22T00:00:00.000Z', ${record.completedAt}, ${record.profileJson}, ${record.error})`,
  );
  const failures = await runRepository(
    ArtifactRepository.use((repository) =>
      Effect.all([repository.get(artifactId).pipe(Effect.flip), repository.list.pipe(Effect.flip)]),
    ),
  );
  for (const failure of failures) expect(failure._tag).toBe("StorageFailure");
});
