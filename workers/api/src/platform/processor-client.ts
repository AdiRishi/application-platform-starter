import type { ArtifactId, ProcessingState } from "@repo/contracts/artifacts";
import { ProcessorRpcs } from "@repo/contracts/artifacts/processor";
import { withRpcClient } from "@repo/contracts/client";
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
          return yield* withRpcClient(
            ProcessorRpcs,
            {
              binding: env.PROCESSOR,
              service: "processor",
              timeout: Duration.seconds(5),
            },
            (client) => client.getProcessingState({ artifactId }),
          ).pipe(Effect.mapError((cause) => new ProcessorFailure({ artifactId, cause })));
        }),
      });
    }),
  );
}
