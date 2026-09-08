import { ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { ApiRpcs } from "@repo/contracts/artifacts/api";
import { rpcHttpRouter } from "@repo/contracts/server";
import { Effect, Layer } from "effect";

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

const handlers = ApiRpcs.toLayer({
  getArtifact: ({ artifactId }) =>
    Artifacts.use((artifacts) => artifacts.get(artifactId)).pipe(
      Effect.catchTags({
        ProcessorFailure: unavailable,
        StorageFailure: unavailable,
      }),
    ),
  listArtifacts: () =>
    Artifacts.use((artifacts) => artifacts.list).pipe(
      Effect.catchTag("StorageFailure", unavailable),
    ),
}).pipe(Layer.provide(Artifacts.live));

export const artifactRpcRoutes = rpcHttpRouter(ApiRpcs, handlers);
