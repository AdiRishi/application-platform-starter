import { ArtifactId, CsvProfile } from "@repo/contracts";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Schema } from "effect";

import { ProfileFailure } from "./errors.ts";

const SourceRow = Schema.Struct({ byte_size: Schema.Int, object_key: Schema.String });
const decodeSourceRow = (input: unknown) =>
  Schema.decodeUnknownEffect(SourceRow)(input).pipe(
    Effect.mapError(
      (cause) =>
        new ProfileFailure({ cause, message: "The artifact record contains invalid data." }),
    ),
  );

const attempt = <A>(message: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ProfileFailure({ cause, message }),
  });

export const getSourceBytes = Effect.fn("Processor.getSourceBytes")(function* (
  env: ProcessorEnv,
  artifactId: ArtifactId,
) {
  const rawRow = yield* attempt("The artifact record could not be read.", () =>
    env.DB.prepare("SELECT object_key, byte_size FROM artifacts WHERE id = ?")
      .bind(artifactId)
      .first(),
  );
  if (rawRow === null) {
    return yield* new ProfileFailure({
      cause: new Error(`Missing artifact ${artifactId}`),
      message: "The artifact record no longer exists.",
    });
  }
  const row = yield* decodeSourceRow(rawRow);
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
});

export const markProcessing = Effect.fn("Processor.markProcessing")(function* (
  env: ProcessorEnv,
  artifactId: ArtifactId,
) {
  yield* attempt("The artifact could not be marked as processing.", () =>
    env.DB.prepare(
      "UPDATE artifacts SET status = 'processing' WHERE id = ? AND status IN ('queued', 'processing')",
    )
      .bind(artifactId)
      .run(),
  );
});

export const markComplete = Effect.fn("Processor.markComplete")(function* (
  env: ProcessorEnv,
  artifactId: ArtifactId,
  profile: CsvProfile,
) {
  const encoded = Schema.encodeSync(CsvProfile)(profile);
  yield* attempt("The profile result could not be stored.", () =>
    env.DB.prepare(
      `UPDATE artifacts
       SET status = 'complete', completed_at = ?, profile_json = ?, error_message = NULL
       WHERE id = ?`,
    )
      .bind(new Date().toISOString(), JSON.stringify(encoded), artifactId)
      .run(),
  );
});

export const markFailed = Effect.fn("Processor.markFailed")(function* (
  env: ProcessorEnv,
  artifactId: ArtifactId,
  message: string,
) {
  yield* attempt("The artifact failure could not be stored.", () =>
    env.DB.prepare(
      `UPDATE artifacts
       SET status = 'failed', completed_at = ?, profile_json = NULL, error_message = ?
       WHERE id = ?`,
    )
      .bind(new Date().toISOString(), message, artifactId)
      .run(),
  );
});
