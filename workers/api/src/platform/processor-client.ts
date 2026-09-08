import type { ArtifactId, ProcessingState } from "@repo/contracts/artifacts";
import type { Processor } from "@repo/infra/processor";
import { Context, Effect, Layer } from "effect";

import { ProcessorFailure } from "../artifacts/errors.ts";

export class ProcessorClient extends Context.Service<
  ProcessorClient,
  {
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProcessorFailure>;
  }
>()("Api/ProcessorClient") {
  static readonly layer = (processor: Pick<Processor, "getProcessingState">) =>
    Layer.succeed(
      ProcessorClient,
      ProcessorClient.of({
        getProcessingState: Effect.fn("ProcessorClient.getProcessingState")((artifactId) =>
          processor.getProcessingState(artifactId).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError((cause) => new ProcessorFailure({ artifactId, cause })),
          ),
        ),
      }),
    );
}
