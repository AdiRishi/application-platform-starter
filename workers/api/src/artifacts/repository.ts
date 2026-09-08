import {
  ArtifactByteSize,
  ArtifactId,
  ArtifactNotFound,
  CsvProfile,
} from "@repo/contracts/artifacts";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { StorageFailure } from "./errors.ts";

const storedFields = {
  byte_size: ArtifactByteSize,
  content_type: Schema.String,
  created_at: Schema.String,
  file_name: Schema.String,
  id: ArtifactId,
  object_key: Schema.String,
};
const StoredArtifact = Schema.Union([
  Schema.Struct({
    ...storedFields,
    status: Schema.Literals(["queued", "processing"]),
    completed_at: Schema.Null,
    error_message: Schema.Null,
    profile_json: Schema.Null,
  }),
  Schema.Struct({
    ...storedFields,
    status: Schema.Literal("complete"),
    completed_at: Schema.String,
    error_message: Schema.Null,
    profile_json: Schema.fromJsonString(CsvProfile),
  }),
  Schema.Struct({
    ...storedFields,
    status: Schema.Literal("failed"),
    completed_at: Schema.String,
    error_message: Schema.String,
    profile_json: Schema.Null,
  }),
]);
const SourceArtifact = Schema.Struct({
  file_name: Schema.String,
  object_key: Schema.String,
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

/** @effect-expect-leaking RuntimeContext */
export class ArtifactRepository extends Context.Service<
  ArtifactRepository,
  {
    readonly get: (
      artifactId: ArtifactId,
    ) => Effect.Effect<StoredArtifact, ArtifactNotFound | StorageFailure, RuntimeContext>;
    readonly insert: (
      artifact: NewArtifactRecord,
    ) => Effect.Effect<void, StorageFailure, RuntimeContext>;
    readonly pendingDelivery: Effect.Effect<
      ReadonlyArray<{ readonly id: ArtifactId }>,
      StorageFailure,
      RuntimeContext
    >;
    readonly markDispatched: (
      artifactId: ArtifactId,
    ) => Effect.Effect<void, StorageFailure, RuntimeContext>;
    readonly list: Effect.Effect<ReadonlyArray<StoredArtifact>, StorageFailure, RuntimeContext>;
    readonly readSource: (artifactId: ArtifactId) => Effect.Effect<
      {
        readonly object: NonNullable<Effect.Success<ReturnType<ReadWriteBucketClient["get"]>>>;
        readonly row: typeof SourceArtifact.Type;
      },
      ArtifactNotFound | StorageFailure,
      RuntimeContext
    >;
    readonly storeSource: (
      artifact: NewArtifactRecord,
      file: File,
    ) => Effect.Effect<void, StorageFailure, RuntimeContext>;
  }
>()("Api/ArtifactRepository") {
  static readonly layer = (bucket: ReadWriteBucketClient) =>
    Layer.effect(
      ArtifactRepository,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const findArtifact = SqlSchema.findOne({
          Request: ArtifactId,
          Result: StoredArtifact,
          execute: (artifactId) => sql`
          SELECT id, file_name, object_key, content_type, byte_size, status,
                 created_at, completed_at, profile_json, error_message
          FROM artifacts WHERE id = ${artifactId}
        `,
        });
        const get = Effect.fn("ArtifactRepository.get")((artifactId: ArtifactId) =>
          findArtifact(artifactId).pipe(
            Effect.catchTags({
              NoSuchElementError: () => new ArtifactNotFound({ artifactId }),
              SchemaError: (cause) =>
                new StorageFailure({ cause, operation: "validate artifact record" }),
              SqlError: (cause) => new StorageFailure({ cause, operation: "get artifact" }),
            }),
          ),
        );

        const findSource = SqlSchema.findOne({
          Request: ArtifactId,
          Result: SourceArtifact,
          execute: (artifactId) => sql`
          SELECT file_name, object_key FROM artifacts WHERE id = ${artifactId}
        `,
        });

        return ArtifactRepository.of({
          get,
          pendingDelivery: sql`
          SELECT id FROM artifacts
          WHERE dispatched_at IS NULL AND status = 'queued'
          ORDER BY created_at LIMIT 100
        `.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: ArtifactId }))),
            ),
            Effect.mapError(
              (cause) =>
                new StorageFailure({ cause, operation: "list pending profile deliveries" }),
            ),
          ),
          markDispatched: Effect.fn("ArtifactRepository.markDispatched")(function* (artifactId) {
            yield* sql`
            UPDATE artifacts SET dispatched_at = ${DateTime.formatIso(yield* DateTime.now)}
            WHERE id = ${artifactId} AND dispatched_at IS NULL
          `.pipe(
              Effect.mapError(
                (cause) => new StorageFailure({ cause, operation: "mark profile dispatched" }),
              ),
            );
          }),
          insert: Effect.fn("ArtifactRepository.insert")(function* (artifact) {
            yield* sql`
            INSERT INTO artifacts
              (id, file_name, object_key, content_type, byte_size, status, created_at)
            VALUES (${artifact.id}, ${artifact.fileName}, ${artifact.objectKey},
                    ${artifact.contentType}, ${artifact.byteSize}, 'queued', ${artifact.createdAt})
          `.pipe(
              Effect.mapError(
                (cause) => new StorageFailure({ cause, operation: "insert artifact" }),
              ),
            );
          }),
          list: sql`
          SELECT id, file_name, object_key, content_type, byte_size, status,
                 created_at, completed_at, profile_json, error_message
          FROM artifacts ORDER BY created_at DESC LIMIT 20
        `.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredArtifact))),
            Effect.mapError((cause) => new StorageFailure({ cause, operation: "list artifacts" })),
            Effect.withSpan("ArtifactRepository.list"),
          ),
          readSource: Effect.fn("ArtifactRepository.readSource")(function* (artifactId) {
            const row = yield* findSource(artifactId).pipe(
              Effect.catchTags({
                NoSuchElementError: () => new ArtifactNotFound({ artifactId }),
                SchemaError: (cause) =>
                  new StorageFailure({ cause, operation: "validate source record" }),
                SqlError: (cause) =>
                  new StorageFailure({ cause, operation: "get artifact source" }),
              }),
            );
            const object = yield* bucket
              .get(row.object_key)
              .pipe(
                Effect.mapError(
                  (cause) => new StorageFailure({ cause, operation: "read artifact source" }),
                ),
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
            yield* bucket
              .put(artifact.objectKey, file.stream(), {
                customMetadata: { artifactId: artifact.id, fileName: artifact.fileName },
                httpMetadata: { contentType: artifact.contentType },
              })
              .pipe(
                Effect.mapError(
                  (cause) => new StorageFailure({ cause, operation: "store artifact source" }),
                ),
              );
          }),
        });
      }),
    );
}
