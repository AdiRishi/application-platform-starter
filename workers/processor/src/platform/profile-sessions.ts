import type { ArtifactId, ProcessingState } from "@repo/contracts/artifacts";
import type { CsvProfileSession } from "@repo/infra/worker-bindings";
import type { DurableObject } from "alchemy/Cloudflare/Workers";
import { Context, Effect, Layer } from "effect";

import { ProfileFailure } from "../artifacts/errors.ts";

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
  static readonly layer = (sessions: DurableObject<CsvProfileSession>) =>
    Layer.succeed(
      ProfileSessions,
      ProfileSessions.of({
        getProcessingState: Effect.fn("ProfileSessions.getProcessingState")(function* (artifactId) {
          const { state } = yield* sessions
            .getByName(artifactId)
            .getState()
            .pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new ProfileFailure({ cause, message: "The profile session could not be read." }),
                ),
              ),
            );
          return state;
        }),
        reportProgress: Effect.fn("ProfileSessions.reportProgress")(function* ({
          artifactId,
          rowsProcessed,
          totalRows,
        }) {
          yield* sessions
            .getByName(artifactId)
            .progress(rowsProcessed, totalRows)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Profile progress unavailable", cause).pipe(
                  Effect.annotateLogs({ artifactId }),
                ),
              ),
            );
        }),
      }),
    );
}
