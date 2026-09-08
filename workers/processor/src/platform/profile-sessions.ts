import type { ArtifactId, ProcessingState } from "@repo/contracts/artifacts";
import { Context, Effect, Layer } from "effect";

import { ProfileFailure } from "../artifacts/errors.ts";
import { processorRequest } from "./worker-request.ts";

export class ProfileSessions extends Context.Service<
  ProfileSessions,
  {
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProfileFailure>;
    readonly progressReporter: (
      artifactId: ArtifactId,
    ) => Effect.Effect<(rowsProcessed: number, totalRows: number) => Promise<void>, never>;
  }
>()("Processor/ProfileSessions") {
  static readonly layer = Layer.effect(
    ProfileSessions,
    Effect.gen(function* () {
      const { env } = yield* processorRequest.service;
      const context = yield* Effect.context<never>();
      return ProfileSessions.of({
        getProcessingState: Effect.fn("ProfileSessions.getProcessingState")(function* (artifactId) {
          const session = env.PROFILE_SESSIONS.getByName(artifactId);
          const { state } = yield* Effect.tryPromise({
            try: () => session.getState(),
            catch: (cause) =>
              new ProfileFailure({ cause, message: "The profile session could not be read." }),
          });
          return state;
        }),
        progressReporter: (artifactId) =>
          Effect.sync(() => {
            const session = env.PROFILE_SESSIONS.getByName(artifactId);
            return async (rowsProcessed: number, totalRows: number) => {
              try {
                await session.progress(rowsProcessed, totalRows);
              } catch (cause) {
                await Effect.runPromiseWith(context)(
                  Effect.logWarning("Profile progress unavailable", cause).pipe(
                    Effect.annotateLogs({ artifactId }),
                  ),
                );
              }
            };
          }),
      });
    }),
  );
}
