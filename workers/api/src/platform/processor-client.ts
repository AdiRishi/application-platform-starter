import type { ArtifactId, ProcessingState } from "@repo/contracts/artifacts";
import type { Processor } from "@repo/infra/processor";
import { makeRpcStub } from "alchemy/Cloudflare/Bridge";
import { Context, Duration, Effect, Layer } from "effect";

import { ProcessorFailure } from "../artifacts/errors.ts";
import { apiRequest } from "./worker-request.ts";

export class ProcessorClient extends Context.Service<
  ProcessorClient,
  {
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProcessorFailure>;
  }
>()("Api/ProcessorClient") {
  static readonly layer = Layer.effect(
    ProcessorClient,
    Effect.gen(function* () {
      const { env } = yield* apiRequest.service;
      return ProcessorClient.of({
        getProcessingState: Effect.fn("ProcessorClient.getProcessingState")(function* (artifactId) {
          return yield* makeRpcStub<Processor>(env.PROCESSOR)
            .getProcessingState(artifactId)
            .pipe(
              Effect.timeout(Duration.seconds(5)),
              Effect.mapError((cause) => new ProcessorFailure({ artifactId, cause })),
            );
        }),
      });
    }),
  );
}
