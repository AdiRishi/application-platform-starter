import { ArtifactId, ProcessingState, ProfileJob, type ProfileJob as Job } from "@repo/contracts";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Function, Schema } from "effect";

import { ProfileFailure } from "./errors.ts";
import { profileCsv } from "./profile-csv.ts";
import { getSourceBytes, markComplete, markFailed, markProcessing } from "./repository.ts";
export { CsvProfileSession } from "./session.ts";

const decodeArtifactId = Schema.decodeUnknownEffect(ArtifactId);

const decodeStateJson = Function.flow(
  Schema.decodeUnknownEffect(Schema.fromJsonString(ProcessingState)),
  Effect.mapError(
    (cause) => new ProfileFailure({ cause, message: "The profile session is invalid." }),
  ),
);

const parseJob = Function.flow(
  Schema.decodeUnknownEffect(ProfileJob),
  Effect.mapError(
    (cause) => new ProfileFailure({ cause, message: "The queue message is invalid." }),
  ),
);

const processJob = Effect.fn("Processor.processJob")(function* (env: ProcessorEnv, job: Job) {
  const session = env.PROFILE_SESSIONS.getByName(job.artifactId);
  yield* Effect.tryPromise({
    try: () => session.initialize(job.artifactId),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not start." }),
  });
  const current = yield* Effect.tryPromise({
    try: () => session.getState(job.artifactId),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not be read." }),
  });
  const currentState = yield* decodeStateJson(current);
  if (currentState.kind === "complete") return;

  yield* markProcessing(env, job.artifactId);
  const bytes = yield* getSourceBytes(env, job.artifactId);
  const profile = yield* Effect.tryPromise({
    try: () =>
      profileCsv(bytes, (rowsProcessed, totalRows) =>
        session.progress(job.artifactId, rowsProcessed, totalRows),
      ),
    catch: (cause) =>
      cause instanceof ProfileFailure
        ? cause
        : new ProfileFailure({ cause, message: "The CSV could not be profiled." }),
  });
  yield* markComplete(env, job.artifactId, profile);
  yield* Effect.tryPromise({
    try: () => session.complete(job.artifactId),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not finish." }),
  });
  yield* Effect.logInfo("CSV profile completed").pipe(
    Effect.annotateLogs({ artifactId: job.artifactId, rows: profile.rowCount }),
  );
});

const retryMessage = (message: Message<unknown>, env: ProcessorEnv) =>
  parseJob(message.body).pipe(
    Effect.flatMap((job) => processJob(env, job)),
    Effect.matchEffect({
      onFailure: (failure) =>
        Effect.logError("CSV profile attempt failed").pipe(
          Effect.annotateLogs({ message: failure.message }),
          Effect.tap(() => Effect.sync(() => message.retry())),
        ),
      onSuccess: () => Effect.sync(() => message.ack()),
    }),
  );

const exhaustMessage = (message: Message<unknown>, env: ProcessorEnv) =>
  parseJob(message.body).pipe(
    Effect.flatMap((job) =>
      Effect.gen(function* () {
        const failureMessage = "CSV profiling failed after three attempts.";
        yield* markFailed(env, job.artifactId, failureMessage);
        const session = env.PROFILE_SESSIONS.getByName(job.artifactId);
        yield* Effect.tryPromise({
          try: () => session.fail(job.artifactId, failureMessage),
          catch: (cause) => new ProfileFailure({ cause, message: failureMessage }),
        });
      }),
    ),
    Effect.matchEffect({
      onFailure: (failure) =>
        Effect.logError("Dead-letter handling failed").pipe(
          Effect.annotateLogs({ message: failure.message }),
          Effect.tap(() => Effect.sync(() => message.retry())),
        ),
      onSuccess: () => Effect.sync(() => message.ack()),
    }),
  );

const progressResponse = Effect.fn("Processor.progressResponse")(function* (
  request: Request,
  env: ProcessorEnv,
) {
  const match = /^\/artifacts\/([^/]+)\/progress$/.exec(new URL(request.url).pathname);
  if (request.method !== "GET" || match?.[1] === undefined) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }
  const artifactId = yield* decodeArtifactId(match[1]).pipe(
    Effect.mapError(
      (cause) => new ProfileFailure({ cause, message: "The artifact id is invalid." }),
    ),
  );
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  const stateJson = yield* Effect.tryPromise({
    try: () => session.getState(artifactId),
    catch: (cause) =>
      new ProfileFailure({ cause, message: "The profile session could not be read." }),
  });
  const state = yield* decodeStateJson(stateJson);
  return Response.json(Schema.encodeSync(ProcessingState)(state));
});

export default {
  fetch(request: Request, env: ProcessorEnv): Promise<Response> {
    return Effect.runPromise(
      progressResponse(request, env).pipe(
        Effect.catch((failure) =>
          Effect.logError("Processor request failed").pipe(
            Effect.annotateLogs({ message: failure.message }),
            Effect.as(Response.json({ message: failure.message }, { status: 500 })),
          ),
        ),
      ),
    );
  },
  queue(batch: MessageBatch<unknown>, env: ProcessorEnv): Promise<void> {
    const handleMessage =
      batch.queue === env.DEAD_LETTER_QUEUE_NAME
        ? (message: Message<unknown>) => exhaustMessage(message, env)
        : (message: Message<unknown>) => retryMessage(message, env);
    return Effect.runPromise(Effect.forEach(batch.messages, handleMessage, { discard: true }));
  },
} satisfies ExportedHandler<ProcessorEnv>;
