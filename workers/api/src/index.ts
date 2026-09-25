import { BrowserCrypto } from "@effect/platform-browser";
import type { DeploymentConfig } from "@repo/infra/deployment-config";
import type { apiBindings } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { dispatchProfiles } from "./artifacts/dispatch.ts";
import { artifactHttpRoutes } from "./artifacts/http.ts";
import { ArtifactRepository } from "./artifacts/repository.ts";
import { artifactRpc } from "./artifacts/rpc.ts";
import { Artifacts } from "./artifacts/service.ts";
import { ProcessorClient } from "./platform/processor-client.ts";

export const api = Effect.fn("Api.initialize")(function* (
  bindings: Effect.Success<ReturnType<typeof apiBindings>>,
  environment: DeploymentConfig["environment"],
) {
  const repository = yield* ArtifactRepository.pipe(
    Effect.provide(
      ArtifactRepository.layer(bindings.artifacts).pipe(Layer.provide(bindings.database)),
    ),
  );
  const artifacts = yield* Artifacts.pipe(
    Effect.provide(
      Artifacts.layer.pipe(
        Layer.provide([
          Layer.succeed(ArtifactRepository, repository),
          ProcessorClient.layer(bindings.processor),
          BrowserCrypto.layer,
        ]),
      ),
    ),
  );
  const dispatch = dispatchProfiles(bindings.jobs).pipe(
    Effect.provideService(ArtifactRepository, repository),
    Effect.catch((failure) =>
      Effect.logError("Profile dispatch failed", failure.cause).pipe(
        Effect.annotateLogs({ operation: failure.operation }),
      ),
    ),
  );
  const fetch = yield* HttpRouter.toHttpEffect(artifactHttpRoutes(environment, dispatch));
  const rpc = yield* artifactRpc.pipe(
    Effect.provideService(Artifacts, artifacts),
    Effect.provideService(ArtifactRepository, repository),
  );
  return {
    dispatch,
    operations: {
      ...rpc.web,
      ...rpc.processor,
      fetch: fetch.pipe(Effect.provideService(Artifacts, artifacts)),
    },
  };
});

type ArtifactRpc = Effect.Success<typeof artifactRpc>;
export type ApiOperations = Effect.Success<ReturnType<typeof api>>["operations"];
export type WebOperation = keyof ArtifactRpc["web"];
export type ProcessorOperation = keyof ArtifactRpc["processor"];
