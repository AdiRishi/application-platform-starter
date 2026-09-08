import { type ArtifactId, CsvProfile, maxUploadBytes } from "@repo/contracts/artifacts";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { databaseLayer } from "../platform/database.ts";
import { processorRequest } from "../platform/worker-request.ts";
import { ProfileFailure } from "./errors.ts";

const SourceRow = Schema.Struct({ byte_size: Schema.Int, object_key: Schema.String });

const attempt = <A>(message: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ProfileFailure({ cause, message }),
  });

export class ArtifactRepository extends Context.Service<
  ArtifactRepository,
  {
    readonly getSourceBytes: (artifactId: ArtifactId) => Effect.Effect<Uint8Array, ProfileFailure>;
    readonly markComplete: (options: {
      readonly artifactId: ArtifactId;
      readonly profile: CsvProfile;
    }) => Effect.Effect<void, ProfileFailure>;
    readonly markFailed: (options: {
      readonly artifactId: ArtifactId;
      readonly message: string;
    }) => Effect.Effect<void, ProfileFailure>;
    readonly markProcessing: (artifactId: ArtifactId) => Effect.Effect<boolean, ProfileFailure>;
  }
>()("Processor/ArtifactRepository") {
  static readonly layer = Layer.effect(
    ArtifactRepository,
    Effect.gen(function* () {
      const { env } = yield* processorRequest.service;
      const sql = yield* SqlClient.SqlClient;
      return ArtifactRepository.of({
        getSourceBytes: Effect.fn("ArtifactRepository.getSourceBytes")(function* (artifactId) {
          const rows = yield* sql`
            SELECT object_key, byte_size FROM artifacts WHERE id = ${artifactId}
          `.pipe(
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The artifact record could not be read." }),
            ),
          );
          const rawRow = rows[0];
          if (rawRow === undefined) {
            return yield* new ProfileFailure({
              cause: new Error(`Missing artifact ${artifactId}`),
              message: "The artifact record no longer exists.",
            });
          }
          const row = yield* Schema.decodeUnknownEffect(SourceRow)(rawRow).pipe(
            Effect.mapError(
              (cause) =>
                new ProfileFailure({
                  cause,
                  message: "The artifact record contains invalid data.",
                }),
            ),
          );
          if (row.byte_size < 1 || row.byte_size > maxUploadBytes) {
            return yield* new ProfileFailure({
              cause: new Error(`Invalid source size ${row.byte_size}`),
              message: "The artifact source is outside the supported size boundary.",
            });
          }
          const object = yield* attempt("The artifact source could not be read.", () =>
            env.ARTIFACTS.get(row.object_key),
          );
          if (object === null) {
            return yield* new ProfileFailure({
              cause: new Error(`Missing R2 object ${row.object_key}`),
              message: "The artifact source no longer exists.",
            });
          }
          if (object.size !== row.byte_size) {
            return yield* new ProfileFailure({
              cause: new Error(`Expected ${row.byte_size} bytes, received ${object.size}`),
              message: "The artifact source does not match its metadata.",
            });
          }
          const buffer = yield* attempt("The artifact source could not be buffered.", () =>
            object.arrayBuffer(),
          );
          return new Uint8Array(buffer);
        }),
        markComplete: Effect.fn("ArtifactRepository.markComplete")(function* ({
          artifactId,
          profile,
        }) {
          const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(CsvProfile))(
            profile,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The profile result could not be encoded." }),
            ),
          );
          yield* sql`
            UPDATE artifacts
            SET status = 'complete', completed_at = ${DateTime.formatIso(yield* DateTime.now)},
                profile_json = ${encoded}, error_message = NULL
            WHERE id = ${artifactId} AND status IN ('queued', 'processing')
          `.pipe(
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The profile result could not be stored." }),
            ),
          );
        }),
        markFailed: Effect.fn("ArtifactRepository.markFailed")(function* ({ artifactId, message }) {
          yield* sql`
            UPDATE artifacts
            SET status = 'failed', completed_at = ${DateTime.formatIso(yield* DateTime.now)},
                profile_json = NULL, error_message = ${message}
            WHERE id = ${artifactId} AND status IN ('queued', 'processing')
          `.pipe(
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The artifact failure could not be stored." }),
            ),
          );
        }),
        markProcessing: Effect.fn("ArtifactRepository.markProcessing")(function* (artifactId) {
          const rows = yield* sql`
            UPDATE artifacts SET status = 'processing'
            WHERE id = ${artifactId} AND status IN ('queued', 'processing')
            RETURNING id
          `.pipe(
            Effect.mapError(
              (cause) =>
                new ProfileFailure({
                  cause,
                  message: "The artifact could not be marked as processing.",
                }),
            ),
          );
          return rows.length > 0;
        }),
      });
    }),
  ).pipe(Layer.provide(databaseLayer));
}
