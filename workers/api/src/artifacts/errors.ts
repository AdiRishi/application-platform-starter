import { ArtifactId, ArtifactNotFound } from "@repo/contracts/schema";
import { Schema } from "effect";

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  message: Schema.String,
}) {}

export class StorageFailure extends Schema.TaggedError<StorageFailure>()("StorageFailure", {
  cause: Schema.Defect(),
  operation: Schema.String,
}) {}

export class ProcessorFailure extends Schema.TaggedError<ProcessorFailure>()("ProcessorFailure", {
  artifactId: ArtifactId,
  cause: Schema.Defect(),
}) {}

export type ApiFailure = InvalidRequest | ArtifactNotFound | ProcessorFailure | StorageFailure;
