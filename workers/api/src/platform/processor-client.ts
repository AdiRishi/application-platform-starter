import { clientOverBinding, ProcessorRpcs } from "@repo/contracts/client";
import type { ArtifactId, ProcessingState } from "@repo/contracts/schema";
import { Context, Duration, Effect, Layer } from "effect";

import { ProcessorFailure } from "../artifacts/errors.ts";
import { apiRequest, type ApiRequest } from "./worker-request.ts";

export class ProcessorClient extends Context.Service<
  ProcessorClient,
  {
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProcessorFailure, ApiRequest>;
  }
>()("Api/ProcessorClient") {
  static readonly layer = Layer.succeed(
    ProcessorClient,
    ProcessorClient.of({
      getProcessingState: Effect.fn("ProcessorClient.getProcessingState")(function* (artifactId) {
        const { env } = yield* apiRequest.service;
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* clientOverBinding(ProcessorRpcs, {
              binding: env.PROCESSOR,
              service: "processor",
              timeout: Duration.seconds(10),
            });
            return yield* client.getProcessingState({ artifactId });
          }),
        ).pipe(Effect.mapError((cause) => new ProcessorFailure({ artifactId, cause })));
      }),
    }),
  );
}
