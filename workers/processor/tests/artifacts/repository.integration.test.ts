import { ArtifactId } from "@repo/contracts/artifacts";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { ArtifactRepository } from "../../src/artifacts/repository.ts";
import { processorRequest } from "../../src/platform/worker-request.ts";
import { runSql } from "../support/database.ts";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

const emptyProfile = JSON.stringify({
  columns: [],
  malformedRows: 0,
  preview: [],
  rowCount: 0,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
});

test.each([
  { status: "queued", eligible: true, storedStatus: "processing" },
  { status: "processing", eligible: true, storedStatus: "processing" },
  { status: "complete", eligible: false, storedStatus: "complete" },
  { status: "failed", eligible: false, storedStatus: "failed" },
  { status: null, eligible: false, storedStatus: null },
])("processing eligibility for $status artifacts", async ({ status, eligible, storedStatus }) => {
  if (status !== null) {
    await runSql(
      (sql) => sql`
      INSERT INTO artifacts
        (id, file_name, object_key, content_type, byte_size, status, created_at,
         completed_at, profile_json, error_message)
      VALUES (${artifactId}, 'sample.csv', 'source.csv', 'text/csv', 10,
              ${status}, '2026-08-22T00:00:00.000Z',
              ${status === "complete" || status === "failed" ? "2026-08-22T00:00:01.000Z" : null},
              ${status === "complete" ? emptyProfile : null},
              ${status === "failed" ? "Invalid CSV" : null})
    `,
    );
  }
  const result = await Effect.runPromise(
    ArtifactRepository.use((repository) => repository.markProcessing(artifactId)).pipe(
      Effect.provide(ArtifactRepository.layer),
      Effect.provideService(processorRequest.service, {
        env,
        executionContext: createExecutionContext(),
      }),
    ),
  );
  expect(result).toBe(eligible);
  const rows = await runSql((sql) => sql`SELECT status FROM artifacts WHERE id = ${artifactId}`);
  expect(rows).toEqual(storedStatus === null ? [] : [{ status: storedStatus }]);
});
