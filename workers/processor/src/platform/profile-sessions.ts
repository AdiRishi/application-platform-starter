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
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProfileFailure, ProcessorRequest>;
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
      getProcessingState: (artifactId) =>
        withSession(artifactId, "The profile session could not be read.", (session) =>
          session.getState(),
        ).pipe(Effect.map(({ state }) => state)),
      progressReporter: (artifactId) =>
        Effect.map(processorRequest.service, ({ env }) => {
          const session = env.PROFILE_SESSIONS.getByName(artifactId);
          return async (rowsProcessed: number, totalRows: number) => {
            try {
              await session.progress(rowsProcessed, totalRows);
            } catch (cause) {
              await Effect.runPromise(
                Effect.logWarning("Profile progress unavailable", cause).pipe(
                  Effect.annotateLogs({ artifactId }),
                ),
              );
            }
          };
        }),
    }),
  );
}
