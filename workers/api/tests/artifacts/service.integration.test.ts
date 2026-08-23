import { ArtifactId } from "@repo/contracts/schema";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import { expect, test } from "vitest";

import { ArtifactRepository } from "../../src/artifacts/repository.ts";
import { Artifacts } from "../../src/artifacts/service.ts";
import { ProcessorClient } from "../../src/platform/processor-client.ts";
import { apiRequest } from "../../src/platform/worker-request.ts";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("a processing artifact gets progress through the processor client port", async () => {
  await env.DB.prepare(
    `INSERT INTO artifacts
      (id, file_name, object_key, content_type, byte_size, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'processing', ?)`,
  )
    .bind(
      artifactId,
      "transactions.csv",
      `artifacts/${artifactId}/source.csv`,
      "text/csv",
      48,
      "2026-08-22T00:00:00.000Z",
    )
    .run();

  const processor = Layer.succeed(
    ProcessorClient,
    ProcessorClient.of({
      getProcessingState: () =>
        Effect.succeed({ kind: "processing", rowsProcessed: 12, totalRows: 20 }),
    }),
  );
  const services = Artifacts.layer.pipe(
    Layer.provide(Layer.mergeAll(ArtifactRepository.layer, processor)),
  );
  const detail = await Effect.runPromise(
    Artifacts.use((artifacts) => artifacts.get(artifactId)).pipe(
      Effect.provide(services),
      Effect.provideService(apiRequest.service, {
        env,
        executionContext: createExecutionContext(),
      }),
    ),
  );

  expect(detail).toStrictEqual({
    byteSize: 48,
    contentType: "text/csv",
    createdAt: "2026-08-22T00:00:00.000Z",
    fileName: "transactions.csv",
    id: artifactId,
    rowsProcessed: 12,
    status: "processing",
    totalRows: 20,
  });
});
