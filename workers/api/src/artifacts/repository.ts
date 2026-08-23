import { ArtifactId, ArtifactNotFound, type ProfileJob } from "@repo/contracts/schema";
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
    readonly list: Effect.Effect<ReadonlyArray<StoredArtifact>, StorageFailure, ApiRequest>;
    readonly markQueueFailure: (
      artifactId: ArtifactId,
    ) => Effect.Effect<void, StorageFailure, ApiRequest>;
    readonly readSource: (
      artifactId: ArtifactId,
    ) => Effect.Effect<
      { readonly object: R2ObjectBody; readonly row: StoredArtifact },
      ArtifactNotFound | StorageFailure,
      ApiRequest
    >;
    readonly sendProfileJob: (job: ProfileJob) => Effect.Effect<void, StorageFailure, ApiRequest>;
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
      markQueueFailure: Effect.fn("ArtifactRepository.markQueueFailure")(function* (artifactId) {
        const { env } = yield* apiRequest.service;
        yield* attempt("mark queue failure", () =>
          env.DB.prepare(
            `UPDATE artifacts
             SET status = 'failed', completed_at = ?, error_message = ?
             WHERE id = ? AND status = 'queued'`,
          )
            .bind(new Date().toISOString(), "The profiling job could not be queued.", artifactId)
            .run(),
        );
      }),
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
      sendProfileJob: Effect.fn("ArtifactRepository.sendProfileJob")(function* (job) {
        const { env } = yield* apiRequest.service;
        yield* attempt("send profile job", () => env.PROFILE_JOBS.send(job));
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
