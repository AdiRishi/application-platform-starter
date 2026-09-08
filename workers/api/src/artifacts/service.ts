import { BrowserCrypto } from "@effect/platform-browser";
import {
  ArtifactDetail,
  ArtifactId,
  ArtifactNotFound,
  type ArtifactSummary,
  CsvProfile,
} from "@repo/contracts/artifacts";
import { Context, Crypto, DateTime, Effect, Function, Layer, Schema } from "effect";

import { ProcessorClient } from "../platform/processor-client.ts";
import { type ProcessorFailure, StorageFailure } from "./errors.ts";
import { ArtifactRepository, type StoredArtifact } from "./repository.ts";

const decodeArtifactId = Function.flow(
  Schema.decodeUnknownEffect(ArtifactId),
  Effect.mapError((cause) => new StorageFailure({ cause, operation: "validate artifact id" })),
);
const decodeArtifactIdSync = Schema.decodeUnknownSync(ArtifactId);
const decodeProfileJson = Function.flow(
  Schema.decodeUnknownEffect(Schema.fromJsonString(CsvProfile)),
  Effect.mapError((cause) => new StorageFailure({ cause, operation: "validate profile result" })),
);

const commonFields = Effect.fn("Artifacts.commonFields")(function* (row: StoredArtifact) {
  return {
    byteSize: row.byte_size,
    contentType: row.content_type,
    createdAt: row.created_at,
    fileName: row.file_name,
    id: yield* decodeArtifactId(row.id),
  };
});

const toSummary = Effect.fn("Artifacts.toSummary")(function* (
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

type ArtifactServiceFailure = ArtifactNotFound | ProcessorFailure | StorageFailure;

export class Artifacts extends Context.Service<
  Artifacts,
  {
    readonly create: (file: File) => Effect.Effect<ArtifactSummary, StorageFailure>;
    readonly get: (artifactId: ArtifactId) => Effect.Effect<ArtifactDetail, ArtifactServiceFailure>;
    readonly list: Effect.Effect<ReadonlyArray<ArtifactSummary>, StorageFailure>;
    readonly readSource: (
      artifactId: ArtifactId,
    ) => Effect.Effect<
      { readonly object: R2ObjectBody; readonly row: StoredArtifact },
      ArtifactNotFound | StorageFailure
    >;
  }
>()("Api/Artifacts") {
  static readonly layer = Layer.effect(
    Artifacts,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const processor = yield* ProcessorClient;
      const repository = yield* ArtifactRepository;

      const get = Effect.fn("Artifacts.get")(function* (artifactId: ArtifactId) {
        const row = yield* repository.get(artifactId);
        const common = yield* commonFields(row);
        switch (row.status) {
          case "queued":
            return { ...common, status: "queued" } satisfies ArtifactDetail;
          case "processing": {
            const state = yield* processor.getProcessingState(artifactId);
            return {
              ...common,
              rowsProcessed: state.kind === "processing" ? state.rowsProcessed : 0,
              status: "processing",
              totalRows: state.kind === "processing" ? state.totalRows : 0,
            } satisfies ArtifactDetail;
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
            } satisfies ArtifactDetail;
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
            } satisfies ArtifactDetail;
        }
      });

      return Artifacts.of({
        create: Effect.fn("Artifacts.create")(function* (file) {
          const id = decodeArtifactIdSync(
            yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(
                (cause) => new StorageFailure({ cause, operation: "generate artifact id" }),
              ),
            ),
          );
          const artifact = {
            byteSize: file.size,
            contentType: file.type.length > 0 ? file.type : "text/csv",
            createdAt: DateTime.formatIso(yield* DateTime.now),
            fileName: file.name,
            id,
            objectKey: `artifacts/${id}/source.csv`,
          };

          yield* repository.storeSource(artifact, file);
          yield* repository.insert(artifact);

          return {
            byteSize: artifact.byteSize,
            contentType: artifact.contentType,
            createdAt: artifact.createdAt,
            fileName: artifact.fileName,
            id,
            status: "queued",
          } satisfies ArtifactSummary;
        }),
        get,
        list: repository.list.pipe(
          Effect.flatMap((rows) => Effect.forEach(rows, toSummary)),
          Effect.withSpan("Artifacts.list"),
        ),
        readSource: repository.readSource,
      });
    }),
  );

  static readonly live = Artifacts.layer.pipe(
    Layer.provide(
      Layer.mergeAll(ArtifactRepository.layer, ProcessorClient.layer, BrowserCrypto.layer),
    ),
  );
}
