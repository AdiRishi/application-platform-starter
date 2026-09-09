import { type ArtifactId, ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { Effect } from "effect";

import { type ProcessorFailure, StorageFailure } from "./errors.ts";
import { ArtifactRepository } from "./repository.ts";
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
  const repository = yield* ArtifactRepository;
  return {
    getProfileSource: (artifactId: ArtifactId) =>
      repository.getProfileSource(artifactId).pipe(Effect.catchTag("StorageFailure", unavailable)),
    startProfile: (artifactId: ArtifactId) =>
      repository.startProfile(artifactId).pipe(Effect.catchTag("StorageFailure", unavailable)),
    completeProfile: (options: Parameters<typeof repository.completeProfile>[0]) =>
      repository.completeProfile(options).pipe(Effect.catchTag("StorageFailure", unavailable)),
    failProfile: (options: Parameters<typeof repository.failProfile>[0]) =>
      repository.failProfile(options).pipe(Effect.catchTag("StorageFailure", unavailable)),
    getArtifact: ({ artifactId }: { readonly artifactId: ArtifactId }) =>
      artifacts
        .get(artifactId)
        .pipe(Effect.catchTags({ ProcessorFailure: unavailable, StorageFailure: unavailable })),
    listArtifacts: () => artifacts.list.pipe(Effect.catchTag("StorageFailure", unavailable)),
  };
});
