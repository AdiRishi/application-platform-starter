import { ArtifactId, ArtifactNotFound, CsvProfile } from "@repo/contracts/artifacts";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";

import { databaseLayer } from "../platform/database.ts";
import { apiRequest } from "../platform/worker-request.ts";
import { StorageFailure } from "./errors.ts";

const storedFields = {
  byte_size: Schema.Int,
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

export class ArtifactRepository extends Context.Service<
  ArtifactRepository,
  {
    readonly get: (
      artifactId: ArtifactId,
    ) => Effect.Effect<StoredArtifact, ArtifactNotFound | StorageFailure>;
    readonly insert: (artifact: NewArtifactRecord) => Effect.Effect<void, StorageFailure>;
    readonly pendingDelivery: Effect.Effect<
      ReadonlyArray<{ readonly id: ArtifactId }>,
      StorageFailure
    >;
    readonly markDispatched: (artifactId: ArtifactId) => Effect.Effect<void, StorageFailure>;
    readonly list: Effect.Effect<ReadonlyArray<StoredArtifact>, StorageFailure>;
    readonly readSource: (
      artifactId: ArtifactId,
    ) => Effect.Effect<
      { readonly object: R2ObjectBody; readonly row: StoredArtifact },
      ArtifactNotFound | StorageFailure
    >;
    readonly storeSource: (
      artifact: NewArtifactRecord,
      file: File,
    ) => Effect.Effect<void, StorageFailure>;
  }
>()("Api/ArtifactRepository") {
  static readonly layer = Layer.effect(
    ArtifactRepository,
    Effect.gen(function* () {
      const { env } = yield* apiRequest.service;
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
            (cause) => new StorageFailure({ cause, operation: "list pending profile deliveries" }),
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
            Effect.mapError((cause) => new StorageFailure({ cause, operation: "insert artifact" })),
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
          yield* attempt("store artifact source", () =>
            env.ARTIFACTS.put(artifact.objectKey, file.stream(), {
              customMetadata: { artifactId: artifact.id, fileName: artifact.fileName },
              httpMetadata: { contentType: artifact.contentType },
            }),
          );
        }),
      });
    }),
  ).pipe(Layer.provide(databaseLayer));
}
