import { ArtifactId, ArtifactNotFound } from "@repo/contracts/artifacts";
import { Context, Effect, Function, Layer, Schema } from "effect";

import { apiRequest, type ApiRequest } from "../platform/worker-request.ts";
import { StorageFailure } from "./errors.ts";

const StoredArtifact = Schema.Struct({
  byte_size: Schema.Int,
  completed_at: Schema.NullOr(Schema.String),
  content_type: Schema.String,
  created_at: Schema.String,
  error_message: Schema.NullOr(Schema.String),
  file_name: Schema.String,
  id: Schema.String,
  object_key: Schema.String,
  profile_json: Schema.NullOr(Schema.String),
  status: Schema.Literals(["queued", "processing", "complete", "failed"]),
});
export type StoredArtifact = typeof StoredArtifact.Type;

export interface NewArtifactRecord {
  readonly byteSize: number;
  readonly contentType: string;
  readonly createdAt: string;
  readonly fileName: string;
  readonly id: ArtifactId;
  readonly objectKey: string;
}

const attempt = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StorageFailure({ cause, operation }),
  });

const decodeStoredArtifact = Function.flow(
  Schema.decodeUnknownEffect(StoredArtifact),
  Effect.mapError((cause) => new StorageFailure({ cause, operation: "validate artifact record" })),
);

const get = Effect.fn("ArtifactRepository.get")(function* (artifactId: ArtifactId) {
  const { env } = yield* apiRequest.service;
  const row = yield* attempt("get artifact", () =>
    env.DB.prepare(
      `SELECT id, file_name, object_key, content_type, byte_size, status,
              created_at, completed_at, profile_json, error_message
       FROM artifacts
       WHERE id = ?`,
    )
      .bind(artifactId)
      .first(),
  );
  if (row === null) return yield* new ArtifactNotFound({ artifactId });
  return yield* decodeStoredArtifact(row);
});

export class ArtifactRepository extends Context.Service<
  ArtifactRepository,
  {
    readonly get: (
      artifactId: ArtifactId,
    ) => Effect.Effect<StoredArtifact, ArtifactNotFound | StorageFailure, ApiRequest>;
    readonly insert: (
      artifact: NewArtifactRecord,
    ) => Effect.Effect<void, StorageFailure, ApiRequest>;
    readonly pendingDelivery: Effect.Effect<
      ReadonlyArray<{ readonly id: ArtifactId }>,
      StorageFailure,
      ApiRequest
    >;
    readonly markDispatched: (
      artifactId: ArtifactId,
    ) => Effect.Effect<void, StorageFailure, ApiRequest>;
    readonly list: Effect.Effect<ReadonlyArray<StoredArtifact>, StorageFailure, ApiRequest>;
    readonly readSource: (
      artifactId: ArtifactId,
    ) => Effect.Effect<
      { readonly object: R2ObjectBody; readonly row: StoredArtifact },
      ArtifactNotFound | StorageFailure,
      ApiRequest
    >;
    readonly storeSource: (
      artifact: NewArtifactRecord,
      file: File,
    ) => Effect.Effect<void, StorageFailure, ApiRequest>;
  }
>()("Api/ArtifactRepository") {
  static readonly layer = Layer.succeed(
    ArtifactRepository,
    ArtifactRepository.of({
      get,
      pendingDelivery: Effect.gen(function* () {
        const { env } = yield* apiRequest.service;
        const pending = yield* attempt("list pending profile deliveries", () =>
          env.DB.prepare(
            "SELECT id FROM artifacts WHERE dispatched_at IS NULL AND status = 'queued' ORDER BY created_at LIMIT 100",
          ).all(),
        );
        return yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: ArtifactId })))(
          pending.results,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new StorageFailure({ cause, operation: "validate pending profile deliveries" }),
          ),
        );
      }),
      markDispatched: Effect.fn("ArtifactRepository.markDispatched")(function* (artifactId) {
        const { env } = yield* apiRequest.service;
        yield* attempt("mark profile dispatched", () =>
          env.DB.prepare(
            "UPDATE artifacts SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL",
          )
            .bind(new Date().toISOString(), artifactId)
            .run(),
        );
      }),
      insert: Effect.fn("ArtifactRepository.insert")(function* (artifact) {
        const { env } = yield* apiRequest.service;
        yield* attempt("insert artifact", () =>
          env.DB.prepare(
            `INSERT INTO artifacts
              (id, file_name, object_key, content_type, byte_size, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
          )
            .bind(
              artifact.id,
              artifact.fileName,
              artifact.objectKey,
              artifact.contentType,
              artifact.byteSize,
              artifact.createdAt,
            )
            .run(),
        );
      }),
      list: Effect.gen(function* () {
        const { env } = yield* apiRequest.service;
        const result = yield* attempt("list artifacts", () =>
          env.DB.prepare(
            `SELECT id, file_name, object_key, content_type, byte_size, status,
                    created_at, completed_at, profile_json, error_message
             FROM artifacts
             ORDER BY created_at DESC
             LIMIT 20`,
          ).all(),
        );
        return yield* Effect.forEach(result.results, (row) => decodeStoredArtifact(row));
      }).pipe(Effect.withSpan("ArtifactRepository.list")),
      readSource: Effect.fn("ArtifactRepository.readSource")(function* (artifactId) {
        const { env } = yield* apiRequest.service;
        const row = yield* get(artifactId);
        const object = yield* attempt("read artifact source", () =>
          env.ARTIFACTS.get(row.object_key),
        );
        if (object === null) {
          return yield* new StorageFailure({
            cause: new Error(`Missing R2 object ${row.object_key}`),
            operation: "read artifact source",
          });
        }
        return { object, row };
      }),
      storeSource: Effect.fn("ArtifactRepository.storeSource")(function* (artifact, file) {
        const { env } = yield* apiRequest.service;
        yield* attempt("store artifact source", () =>
          env.ARTIFACTS.put(artifact.objectKey, file.stream(), {
            customMetadata: { artifactId: artifact.id, fileName: artifact.fileName },
            httpMetadata: { contentType: artifact.contentType },
          }),
        );
      }),
    }),
  );
}
