import {
  ArtifactId,
  type ArtifactDetail,
  type ArtifactSummary,
  CsvProfile,
  ProcessingState,
  type ProfileJob,
} from "@repo/contracts";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect, Schema } from "effect";

import { ArtifactNotFound, StorageFailure } from "./errors.ts";

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
type StoredArtifact = typeof StoredArtifact.Type;

const attempt = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new StorageFailure({ cause, operation }),
  });

const decodeStoredArtifact = (input: unknown) =>
  Schema.decodeUnknownEffect(StoredArtifact)(input).pipe(
    Effect.mapError(
      (cause) => new StorageFailure({ cause, operation: "validate artifact record" }),
    ),
  );
const decodeArtifactId = (input: unknown) =>
  Schema.decodeUnknownEffect(ArtifactId)(input).pipe(
    Effect.mapError((cause) => new StorageFailure({ cause, operation: "validate artifact id" })),
  );
const decodeProfile = (input: unknown) =>
  Schema.decodeUnknownEffect(CsvProfile)(input).pipe(
    Effect.mapError((cause) => new StorageFailure({ cause, operation: "validate profile result" })),
  );

const commonFields = Effect.fn("Api.commonFields")(function* (row: StoredArtifact) {
  return {
    byteSize: row.byte_size,
    contentType: row.content_type,
    createdAt: row.created_at,
    fileName: row.file_name,
    id: yield* decodeArtifactId(row.id),
  };
});

const decodeProfileJson = Effect.fn("Api.decodeProfileJson")(function* (json: string) {
  const input = yield* Effect.try({
    try: (): unknown => JSON.parse(json),
    catch: (cause) => new StorageFailure({ cause, operation: "parse profile result" }),
  });
  return yield* decodeProfile(input);
});

const toSummary = Effect.fn("Api.toSummary")(function* (
  row: StoredArtifact,
): Effect.fn.Return<ArtifactSummary, StorageFailure> {
  const common = yield* commonFields(row);
  switch (row.status) {
    case "queued":
    case "processing":
      return { ...common, status: row.status };
    case "complete": {
      if (row.completed_at === null || row.profile_json === null) {
        return yield* new StorageFailure({
          cause: new Error(`Complete artifact ${row.id} is missing its result`),
          operation: "decode complete artifact",
        });
      }
      const profile = yield* decodeProfileJson(row.profile_json);
      return {
        ...common,
        completedAt: row.completed_at,
        malformedRows: profile.malformedRows,
        rowCount: profile.rowCount,
        status: "complete",
      };
    }
    case "failed":
      if (row.completed_at === null || row.error_message === null) {
        return yield* new StorageFailure({
          cause: new Error(`Failed artifact ${row.id} is missing its error`),
          operation: "decode failed artifact",
        });
      }
      return {
        ...common,
        completedAt: row.completed_at,
        error: row.error_message,
        status: "failed",
      };
  }
});

const fetchProcessingState = Effect.fn("Api.fetchProcessingState")(function* (
  env: ApiEnv,
  artifactId: ArtifactId,
) {
  const response = yield* attempt("read processing state", () =>
    env.PROCESSOR.fetch(`https://processor.internal/artifacts/${artifactId}/progress`),
  );
  if (!response.ok) {
    return yield* new StorageFailure({
      cause: new Error(`Processor returned ${response.status}`),
      operation: "read processing state",
    });
  }
  const body: unknown = yield* attempt("decode processing state", () => response.json());
  return yield* Schema.decodeUnknownEffect(ProcessingState)(body).pipe(
    Effect.mapError(
      (cause) => new StorageFailure({ cause, operation: "validate processing state" }),
    ),
  );
});

export const insertArtifact = Effect.fn("Api.insertArtifact")(function* (
  env: ApiEnv,
  artifact: {
    readonly byteSize: number;
    readonly contentType: string;
    readonly createdAt: string;
    readonly fileName: string;
    readonly id: ArtifactId;
    readonly objectKey: string;
  },
) {
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
});

export const markQueueFailure = Effect.fn("Api.markQueueFailure")(function* (
  env: ApiEnv,
  artifactId: ArtifactId,
) {
  yield* attempt("mark queue failure", () =>
    env.DB.prepare(
      `UPDATE artifacts
       SET status = 'failed', completed_at = ?, error_message = ?
       WHERE id = ? AND status = 'queued'`,
    )
      .bind(new Date().toISOString(), "The profiling job could not be queued.", artifactId)
      .run(),
  );
});

export const listArtifacts = Effect.fn("Api.listArtifacts")(function* (env: ApiEnv) {
  const result = yield* attempt("list artifacts", () =>
    env.DB.prepare(
      `SELECT id, file_name, object_key, content_type, byte_size, status,
              created_at, completed_at, profile_json, error_message
       FROM artifacts
       ORDER BY created_at DESC
       LIMIT 20`,
    ).all(),
  );
  return yield* Effect.forEach(result.results, (row) =>
    decodeStoredArtifact(row).pipe(Effect.flatMap(toSummary)),
  );
});

export const getStoredArtifact = Effect.fn("Api.getStoredArtifact")(function* (
  env: ApiEnv,
  artifactId: ArtifactId,
) {
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

export const getArtifactDetail = Effect.fn("Api.getArtifactDetail")(function* (
  env: ApiEnv,
  artifactId: ArtifactId,
): Effect.fn.Return<ArtifactDetail, ArtifactNotFound | StorageFailure> {
  const row = yield* getStoredArtifact(env, artifactId);
  const common = yield* commonFields(row);
  switch (row.status) {
    case "queued":
    case "processing": {
      const processing = yield* fetchProcessingState(env, artifactId);
      return { ...common, processing, status: row.status };
    }
    case "complete":
      if (row.completed_at === null || row.profile_json === null) {
        return yield* new StorageFailure({
          cause: new Error(`Complete artifact ${row.id} is missing its result`),
          operation: "decode complete artifact",
        });
      }
      return {
        ...common,
        completedAt: row.completed_at,
        profile: yield* decodeProfileJson(row.profile_json),
        status: "complete",
      };
    case "failed":
      if (row.completed_at === null || row.error_message === null) {
        return yield* new StorageFailure({
          cause: new Error(`Failed artifact ${row.id} is missing its error`),
          operation: "decode failed artifact",
        });
      }
      return {
        ...common,
        completedAt: row.completed_at,
        error: row.error_message,
        status: "failed",
      };
  }
});

export const getSource = Effect.fn("Api.getSource")(function* (
  env: ApiEnv,
  artifactId: ArtifactId,
) {
  const row = yield* getStoredArtifact(env, artifactId);
  const object = yield* attempt("read artifact source", () => env.ARTIFACTS.get(row.object_key));
  if (object === null) {
    return yield* new StorageFailure({
      cause: new Error(`Missing R2 object ${row.object_key}`),
      operation: "read artifact source",
    });
  }
  return { object, row };
});

export const sendProfileJob = Effect.fn("Api.sendProfileJob")(function* (
  env: ApiEnv,
  job: ProfileJob,
) {
  yield* attempt("send profile job", () => env.PROFILE_JOBS.send(job));
});
