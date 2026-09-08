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
    readonly reportProgress: (options: {
      readonly artifactId: ArtifactId;
      readonly rowsProcessed: number;
      readonly totalRows: number;
    }) => Effect.Effect<void>;
  }
>()("Processor/ProfileSessions") {
  static readonly layer = Layer.effect(
    ProfileSessions,
    Effect.gen(function* () {
      const { env } = yield* processorRequest.service;
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
        reportProgress: Effect.fn("ProfileSessions.reportProgress")(function* ({
          artifactId,
          rowsProcessed,
          totalRows,
        }) {
          const session = env.PROFILE_SESSIONS.getByName(artifactId);
          yield* Effect.tryPromise(() => session.progress(rowsProcessed, totalRows)).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Profile progress unavailable", cause).pipe(
                Effect.annotateLogs({ artifactId }),
              ),
            ),
          );
        }),
      });
    }),
  );
}
