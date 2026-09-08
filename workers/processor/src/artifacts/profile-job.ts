import { ProfileJob } from "@repo/contracts/artifacts";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Function, Schema } from "effect";

import { processorRequest } from "../platform/worker-request.ts";
import { InvalidProfileJob } from "./errors.ts";
import { ArtifactProcessing } from "./service.ts";

const parseJob = Function.flow(
  Schema.decodeUnknownEffect(ProfileJob),
  Effect.mapError((cause) => new InvalidProfileJob({ cause })),
);

const handleMessage = Effect.fn("ArtifactProcessing.handleMessage")(
  function* (message: Message<unknown>, deadLetter: boolean) {
    const job = yield* parseJob(message.body);
    const processing = yield* ArtifactProcessing;
    yield* (deadLetter ? processing.exhaust(job) : processing.process(job)).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          Effect.logError(
            deadLetter ? "Dead-letter handling failed" : "CSV profile attempt failed",
            failure.cause,
          ).pipe(
            Effect.annotateLogs({ artifactId: job.artifactId, message: failure.message }),
            Effect.tap(() => Effect.sync(() => message.retry())),
          ),
        onSuccess: () => Effect.sync(() => message.ack()),
      }),
    );
  },
  (effect, message) =>
    effect.pipe(
      Effect.catchTag("InvalidProfileJob", () =>
        Effect.logWarning("Discarding an invalid profile queue message").pipe(
          Effect.tap(() => Effect.sync(() => message.ack())),
        ),
      ),
    ),
);

export const handleQueue = (
  batch: MessageBatch<unknown>,
  env: ProcessorEnv,
  executionContext: ExecutionContext,
): Promise<void> => {
  const deadLetter = batch.queue === env.DEAD_LETTER_QUEUE_NAME;
  return Effect.runPromise(
    Effect.forEach(batch.messages, (message) => handleMessage(message, deadLetter), {
      discard: true,
    }).pipe(
      Effect.provide(ArtifactProcessing.live),
      Effect.provideService(processorRequest.service, { env, executionContext }),
    ),
  );
};
