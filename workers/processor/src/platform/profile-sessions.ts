import type { ArtifactId, ProcessingState } from "@repo/contracts/schema";
import { Context, Effect, Layer } from "effect";

import { ProfileFailure } from "../artifacts/errors.ts";
import { processorRequest, type ProcessorRequest } from "./worker-request.ts";

type ProfileSession = ReturnType<ProcessorRequest["env"]["PROFILE_SESSIONS"]["getByName"]>;

const withSession = <A>(
  artifactId: ArtifactId,
  message: string,
  run: (session: ProfileSession) => Promise<A>,
) =>
  Effect.gen(function* () {
    const { env } = yield* processorRequest.service;
    const session = env.PROFILE_SESSIONS.getByName(artifactId);
    return yield* Effect.tryPromise({
      try: () => run(session),
      catch: (cause) => new ProfileFailure({ cause, message }),
    });
  });

export class ProfileSessions extends Context.Service<
  ProfileSessions,
  {
    readonly complete: (
      artifactId: ArtifactId,
    ) => Effect.Effect<void, ProfileFailure, ProcessorRequest>;
    readonly fail: (options: {
      readonly artifactId: ArtifactId;
      readonly message: string;
    }) => Effect.Effect<void, ProfileFailure, ProcessorRequest>;
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProfileFailure, ProcessorRequest>;
    readonly initialize: (
      artifactId: ArtifactId,
    ) => Effect.Effect<void, ProfileFailure, ProcessorRequest>;
    readonly progressReporter: (
      artifactId: ArtifactId,
    ) => Effect.Effect<
      (rowsProcessed: number, totalRows: number) => Promise<void>,
      never,
      ProcessorRequest
    >;
  }
>()("Processor/ProfileSessions") {
  static readonly layer = Layer.succeed(
    ProfileSessions,
    ProfileSessions.of({
      complete: (artifactId) =>
        withSession(artifactId, "The profile session could not finish.", (session) =>
          session.complete(),
        ),
      fail: ({ artifactId, message }) =>
        withSession(artifactId, message, async (session) => {
          await session.initialize(artifactId);
          await session.fail(message);
        }),
      getProcessingState: (artifactId) =>
        withSession(artifactId, "The profile session could not be read.", (session) =>
          session.getState(),
        ).pipe(Effect.map(({ state }) => state)),
      initialize: (artifactId) =>
        withSession(artifactId, "The profile session could not start.", (session) =>
          session.initialize(artifactId),
        ),
      progressReporter: (artifactId) =>
        Effect.map(processorRequest.service, ({ env }) => {
          const session = env.PROFILE_SESSIONS.getByName(artifactId);
          return async (rowsProcessed: number, totalRows: number) => {
            try {
              await session.progress(rowsProcessed, totalRows);
            } catch (cause) {
              throw new ProfileFailure({
                cause,
                message: "The profile progress could not be recorded.",
              });
            }
          };
        }),
    }),
  );
}
