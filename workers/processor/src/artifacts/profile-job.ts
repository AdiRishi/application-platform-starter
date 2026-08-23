import { ProfileJob } from "@repo/contracts/schema";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Function, Schema } from "effect";

import { processorRequest } from "../platform/worker-request.ts";
import { InvalidProfileJob } from "./errors.ts";
import { ArtifactProcessing } from "./service.ts";

const parseJob = Function.flow(
  Schema.decodeUnknownEffect(ProfileJob),
  Effect.mapError((cause) => new InvalidProfileJob({ cause })),
);

const acknowledgeInvalidJob = (message: Message<unknown>) =>
  Effect.logWarning("Discarding an invalid profile queue message").pipe(
    Effect.tap(() => Effect.sync(() => message.ack())),
  );

const retryMessage = (message: Message<unknown>) =>
  parseJob(message.body).pipe(
    Effect.matchEffect({
      onFailure: () => acknowledgeInvalidJob(message),
      onSuccess: (job) =>
        ArtifactProcessing.use((processing) => processing.process(job)).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.logError("CSV profile attempt failed", failure.cause).pipe(
                Effect.annotateLogs({ message: failure.message }),
                Effect.tap(() => Effect.sync(() => message.retry())),
              ),
            onSuccess: () => Effect.sync(() => message.ack()),
          }),
        ),
    }),
  );

const exhaustMessage = (message: Message<unknown>) =>
  parseJob(message.body).pipe(
    Effect.matchEffect({
      onFailure: () => acknowledgeInvalidJob(message),
      onSuccess: (job) =>
        ArtifactProcessing.use((processing) => processing.exhaust(job)).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.logError("Dead-letter handling failed", failure.cause).pipe(
                Effect.annotateLogs({ message: failure.message }),
                Effect.tap(() => Effect.sync(() => message.retry())),
              ),
            onSuccess: () => Effect.sync(() => message.ack()),
          }),
        ),
    }),
  );

export const handleQueue = (
  batch: MessageBatch<unknown>,
  env: ProcessorEnv,
  executionContext: ExecutionContext,
): Promise<void> => {
  const handleMessage = batch.queue === env.DEAD_LETTER_QUEUE_NAME ? exhaustMessage : retryMessage;
  return Effect.runPromise(
    Effect.forEach(batch.messages, handleMessage, { discard: true }).pipe(
      Effect.provide(ArtifactProcessing.live),
      Effect.provideService(processorRequest.service, { env, executionContext }),
    ),
  );
};
