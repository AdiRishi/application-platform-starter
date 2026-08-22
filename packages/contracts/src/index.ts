import { Schema } from "effect";

export const maxUploadBytes = 10 * 1024 * 1024;

export const ArtifactId = Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand("ArtifactId"));
export type ArtifactId = typeof ArtifactId.Type;

export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("Sha256"),
);
export type Sha256 = typeof Sha256.Type;

const columnFields = {
  name: Schema.String,
  emptyValues: Schema.Int,
  nonEmptyValues: Schema.Int,
};

export const ColumnProfile = Schema.Union([
  Schema.Struct({ ...columnFields, kind: Schema.Literal("empty") }),
  Schema.Struct({
    ...columnFields,
    kind: Schema.Literal("boolean"),
    falseValues: Schema.Int,
    trueValues: Schema.Int,
  }),
  Schema.Struct({
    ...columnFields,
    kind: Schema.Literal("number"),
    maximum: Schema.Number,
    minimum: Schema.Number,
  }),
  Schema.Struct({
    ...columnFields,
    kind: Schema.Literal("date"),
    maximum: Schema.String,
    minimum: Schema.String,
  }),
  Schema.Struct({ ...columnFields, kind: Schema.Literal("string") }),
]);
export type ColumnProfile = typeof ColumnProfile.Type;

export const CsvProfile = Schema.Struct({
  columns: Schema.Array(ColumnProfile),
  malformedRows: Schema.Int,
  preview: Schema.Array(Schema.Array(Schema.String)),
  rowCount: Schema.Int,
  sha256: Sha256,
});
export type CsvProfile = typeof CsvProfile.Type;

const artifactFields = {
  byteSize: Schema.Int,
  contentType: Schema.String,
  createdAt: Schema.String,
  fileName: Schema.String,
  id: ArtifactId,
};

export const ArtifactSummary = Schema.Union([
  Schema.Struct({ ...artifactFields, status: Schema.Literal("queued") }),
  Schema.Struct({ ...artifactFields, status: Schema.Literal("processing") }),
  Schema.Struct({
    ...artifactFields,
    completedAt: Schema.String,
    malformedRows: Schema.Int,
    rowCount: Schema.Int,
    status: Schema.Literal("complete"),
  }),
  Schema.Struct({
    ...artifactFields,
    completedAt: Schema.String,
    error: Schema.String,
    status: Schema.Literal("failed"),
  }),
]);
export type ArtifactSummary = typeof ArtifactSummary.Type;

export const ProcessingState = Schema.Union([
  Schema.Struct({ artifactId: ArtifactId, kind: Schema.Literal("queued") }),
  Schema.Struct({
    artifactId: ArtifactId,
    kind: Schema.Literal("processing"),
    rowsProcessed: Schema.Int,
    totalRows: Schema.Int,
  }),
  Schema.Struct({ artifactId: ArtifactId, kind: Schema.Literal("complete") }),
  Schema.Struct({ artifactId: ArtifactId, kind: Schema.Literal("failed"), message: Schema.String }),
]);
export type ProcessingState = typeof ProcessingState.Type;

export const ArtifactDetail = Schema.Union([
  Schema.Struct({
    ...artifactFields,
    processing: ProcessingState,
    status: Schema.Literal("queued"),
  }),
  Schema.Struct({
    ...artifactFields,
    processing: ProcessingState,
    status: Schema.Literal("processing"),
  }),
  Schema.Struct({
    ...artifactFields,
    completedAt: Schema.String,
    profile: CsvProfile,
    status: Schema.Literal("complete"),
  }),
  Schema.Struct({
    ...artifactFields,
    completedAt: Schema.String,
    error: Schema.String,
    status: Schema.Literal("failed"),
  }),
]);
export type ArtifactDetail = typeof ArtifactDetail.Type;

export const ListArtifactsResponse = Schema.Array(ArtifactSummary);
export type ListArtifactsResponse = typeof ListArtifactsResponse.Type;

export const ProfileJob = Schema.Struct({ artifactId: ArtifactId });
export type ProfileJob = typeof ProfileJob.Type;

export const ApiError = Schema.Struct({
  code: Schema.Literals(["invalid_request", "not_found", "storage_failure"]),
  message: Schema.String,
});
export type ApiError = typeof ApiError.Type;
