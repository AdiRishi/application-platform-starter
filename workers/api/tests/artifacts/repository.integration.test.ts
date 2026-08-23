import { ArtifactId, ProcessorRpcs } from "@repo/contracts";
import { env } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { expect, test } from "vitest";

import { ProcessorClient } from "../../src/artifacts/processing-client.ts";
import { getArtifactDetail } from "../../src/artifacts/repository.ts";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("a processing artifact gets progress through the typed processor client", async () => {
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

  const handlers = ProcessorRpcs.toLayer({
    getProcessingState: () =>
      Effect.succeed({ kind: "processing", rowsProcessed: 12, totalRows: 20 } as const),
  });
  const client = Layer.effect(ProcessorClient)(RpcTest.makeClient(ProcessorRpcs)).pipe(
    Layer.provide(handlers),
  );
  const detail = await Effect.runPromise(
    getArtifactDetail(env, artifactId).pipe(Effect.provide(client), Effect.scoped),
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
