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
