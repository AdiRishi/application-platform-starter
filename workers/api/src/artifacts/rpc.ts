import { ArtifactsUnavailable } from "@repo/contracts/schema";
import { ApiRpcs, rpcWebHandler } from "@repo/contracts/server";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";

import { apiRequest } from "../platform/worker-request.ts";
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

const rpc = rpcWebHandler(ApiRpcs, handlers);

export const handleRpcRequest = (
  request: Request,
  env: ApiEnv,
  executionContext: ExecutionContext,
) => rpc.handler(request, apiRequest.forRequest(env, executionContext));
