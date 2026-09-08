import { ArtifactByteSize, type ArtifactId, CsvProfile } from "@repo/contracts/artifacts";
import type { ReadBucketClient } from "alchemy/Cloudflare/R2";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { ProfileFailure } from "./errors.ts";

const SourceRow = Schema.Struct({ byte_size: ArtifactByteSize, object_key: Schema.String });

/** @effect-expect-leaking RuntimeContext */
export class ArtifactRepository extends Context.Service<
  ArtifactRepository,
  {
    readonly getSourceBytes: (
      artifactId: ArtifactId,
    ) => Effect.Effect<Uint8Array, ProfileFailure, RuntimeContext>;
    readonly markComplete: (options: {
      readonly artifactId: ArtifactId;
      readonly profile: CsvProfile;
    }) => Effect.Effect<void, ProfileFailure, RuntimeContext>;
    readonly markFailed: (options: {
      readonly artifactId: ArtifactId;
      readonly message: string;
    }) => Effect.Effect<void, ProfileFailure, RuntimeContext>;
    readonly markProcessing: (
      artifactId: ArtifactId,
    ) => Effect.Effect<boolean, ProfileFailure, RuntimeContext>;
  }
>()("Processor/ArtifactRepository") {
  static readonly layer = (bucket: ReadBucketClient) =>
    Layer.effect(
      ArtifactRepository,
      Effect.gen(function* () {
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
            const object = yield* bucket.get(row.object_key).pipe(
              Effect.mapError(
                (cause) =>
                  new ProfileFailure({
                    cause,
                    message: "The artifact source could not be read.",
                  }),
              ),
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
            const buffer = yield* object.arrayBuffer().pipe(
              Effect.mapError(
                (cause) =>
                  new ProfileFailure({
                    cause,
                    message: "The artifact source could not be buffered.",
                  }),
              ),
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
                  new ProfileFailure({
                    cause,
                    message: "The profile result could not be encoded.",
                  }),
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
          markFailed: Effect.fn("ArtifactRepository.markFailed")(function* ({
            artifactId,
            message,
          }) {
            yield* sql`
            UPDATE artifacts
            SET status = 'failed', completed_at = ${DateTime.formatIso(yield* DateTime.now)},
                profile_json = NULL, error_message = ${message}
            WHERE id = ${artifactId} AND status IN ('queued', 'processing')
          `.pipe(
              Effect.mapError(
                (cause) =>
                  new ProfileFailure({
                    cause,
                    message: "The artifact failure could not be stored.",
                  }),
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
    );
}
