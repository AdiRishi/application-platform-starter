import { Schema } from "effect";

import { ArtifactId } from "./schema";

export class ArtifactNotFound extends Schema.TaggedError<ArtifactNotFound>()("ArtifactNotFound", {
  artifactId: ArtifactId,
}) {}

export class ArtifactsUnavailable extends Schema.TaggedError<ArtifactsUnavailable>()(
  "ArtifactsUnavailable",
  {},
) {}

export class ProcessingStateUnavailable extends Schema.TaggedError<ProcessingStateUnavailable>()(
  "ProcessingStateUnavailable",
  {},
) {}
