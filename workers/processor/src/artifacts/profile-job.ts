import { ProfileJob, type ProfileJob as Job } from "@repo/contracts";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Function, Schema } from "effect";

import { InvalidProfileJob, ProfileFailure } from "./errors.ts";
import { profileCsv } from "./profile-csv.ts";
import { getSourceBytes, markComplete, markFailed, markProcessing } from "./repository.ts";

const parseJob = Function.flow(
  Schema.decodeUnknownEffect(ProfileJob),
  Effect.mapError((cause) => new InvalidProfileJob({ cause })),
);

const processJob = Effect.fn("Processor.processJob")(function* (env: ProcessorEnv, job: Job) {
  const session = env.PROFILE_SESSIONS.getByName(job.artifactId);
  yield* Effect.tryPromise({
    try: () => session.initialize(job.artifactId),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not start." }),
  });
  const current = yield* Effect.tryPromise({
    try: () => session.getState(),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not be read." }),
  });
  const currentState = current.state;
  if (currentState.kind === "complete" || currentState.kind === "failed") return;

  yield* markProcessing(env, job.artifactId);
  const bytes = yield* getSourceBytes(env, job.artifactId);
  const profile = yield* Effect.tryPromise({
    try: () =>
      profileCsv(bytes, (rowsProcessed, totalRows) => session.progress(rowsProcessed, totalRows)),
    catch: (cause) =>
      cause instanceof ProfileFailure
        ? cause
        : new ProfileFailure({ cause, message: "The CSV could not be profiled." }),
  });
  yield* markComplete(env, job.artifactId, profile);
  yield* Effect.tryPromise({
    try: () => session.complete(),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not finish." }),
  });
  yield* Effect.logInfo("CSV profile completed").pipe(
    Effect.annotateLogs({ artifactId: job.artifactId, rows: profile.rowCount }),
  );
});

const acknowledgeInvalidJob = (message: Message<unknown>) =>
  Effect.logWarning("Discarding an invalid profile queue message").pipe(
    Effect.tap(() => Effect.sync(() => message.ack())),
  );

const retryMessage = (message: Message<unknown>, env: ProcessorEnv) =>
  parseJob(message.body).pipe(
    Effect.matchEffect({
      onFailure: () => acknowledgeInvalidJob(message),
      onSuccess: (job) =>
        processJob(env, job).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.logError("CSV profile attempt failed").pipe(
                Effect.annotateLogs({ message: failure.message }),
                Effect.tap(() => Effect.sync(() => message.retry())),
              ),
            onSuccess: () => Effect.sync(() => message.ack()),
          }),
        ),
    }),
  );

const exhaustJob = Effect.fn("Processor.exhaustJob")(function* (env: ProcessorEnv, job: Job) {
  const failureMessage = "CSV profiling failed after three attempts.";
  yield* markFailed(env, job.artifactId, failureMessage);
  const session = env.PROFILE_SESSIONS.getByName(job.artifactId);
  yield* Effect.tryPromise({
    try: async () => {
      await session.initialize(job.artifactId);
      await session.fail(failureMessage);
    },
    catch: (cause) => new ProfileFailure({ cause, message: failureMessage }),
  });
});

const exhaustMessage = (message: Message<unknown>, env: ProcessorEnv) =>
  parseJob(message.body).pipe(
    Effect.matchEffect({
      onFailure: () => acknowledgeInvalidJob(message),
      onSuccess: (job) =>
        exhaustJob(env, job).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.logError("Dead-letter handling failed").pipe(
                Effect.annotateLogs({ message: failure.message }),
                Effect.tap(() => Effect.sync(() => message.retry())),
              ),
            onSuccess: () => Effect.sync(() => message.ack()),
          }),
        ),
    }),
  );

export const handleQueue = (batch: MessageBatch<unknown>, env: ProcessorEnv): Promise<void> => {
  const handleMessage =
    batch.queue === env.DEAD_LETTER_QUEUE_NAME
      ? (message: Message<unknown>) => exhaustMessage(message, env)
      : (message: Message<unknown>) => retryMessage(message, env);
  return Effect.runPromise(Effect.forEach(batch.messages, handleMessage, { discard: true }));
};
