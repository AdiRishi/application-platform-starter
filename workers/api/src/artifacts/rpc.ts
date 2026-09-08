import { type ArtifactId, ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { Effect } from "effect";

import { type ProcessorFailure, StorageFailure } from "./errors.ts";
import { Artifacts } from "./service.ts";

const unavailable = (failure: ProcessorFailure | StorageFailure) => {
  const attributes =
    failure._tag === "ProcessorFailure"
      ? { artifactId: failure.artifactId, operation: "read processing state" }
      : { operation: failure.operation };
  return Effect.logError("Artifact request failed", failure.cause).pipe(
    Effect.annotateLogs(attributes),
    Effect.andThen(Effect.fail(new ArtifactsUnavailable({}))),
  );
};

export const artifactRpc = Effect.gen(function* () {
  const artifacts = yield* Artifacts;
  return {
    getArtifact: ({ artifactId }: { readonly artifactId: ArtifactId }) =>
      artifacts
        .get(artifactId)
        .pipe(Effect.catchTags({ ProcessorFailure: unavailable, StorageFailure: unavailable })),
    listArtifacts: () => artifacts.list.pipe(Effect.catchTag("StorageFailure", unavailable)),
  };
});
