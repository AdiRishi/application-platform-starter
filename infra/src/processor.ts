import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Stream } from "effect";

import type { ArtifactProcessing } from "../../workers/processor/src/artifacts/service.ts";
import { processor } from "../../workers/processor/src/index.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { dataPlane } from "./data-plane.ts";
import { processorBindings } from "./worker-bindings.ts";

export class Processor extends Cloudflare.Worker<
  Processor,
  Pick<ArtifactProcessing["Service"], "getProcessingState">
>()("ProcessorWorker") {}

export default Processor.make(
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
  },
  Effect.gen(function* () {
    const data = yield* dataPlane;
    const bindings = yield* processorBindings();
    const runtime = yield* processor(bindings);

    yield* Cloudflare.Queues.consumeQueueMessages(
      data.profileJobs,
      {
        batchSize: 1,
        maxRetries: 3,
        deadLetterQueue: data.deadLetters.queueName,
      },
      (messages) => Stream.runForEach(messages, runtime.process),
    );
    yield* Cloudflare.Queues.consumeQueueMessages(data.deadLetters, { batchSize: 1 }, (messages) =>
      Stream.runForEach(messages, runtime.exhaust),
    );

    return { getProcessingState: runtime.getProcessingState };
  }).pipe(Effect.provide(Cloudflare.Queues.EventSourceLive)),
);
