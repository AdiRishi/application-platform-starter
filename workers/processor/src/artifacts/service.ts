import type { ArtifactId, ProcessingState, ProfileJob } from "@repo/contracts/schema";
import { Context, Effect, Layer } from "effect";

import { ProfileSessions } from "../platform/profile-sessions.ts";
import type { ProcessorRequest } from "../platform/worker-request.ts";
import { ProfileFailure } from "./errors.ts";
import { profileCsv } from "./profile-csv.ts";
import { ArtifactRepository } from "./repository.ts";

export class ArtifactProcessing extends Context.Service<
  ArtifactProcessing,
  {
    readonly exhaust: (job: ProfileJob) => Effect.Effect<void, ProfileFailure, ProcessorRequest>;
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProfileFailure, ProcessorRequest>;
    readonly process: (job: ProfileJob) => Effect.Effect<void, ProfileFailure, ProcessorRequest>;
  }
>()("Processor/ArtifactProcessing") {
  static readonly layer = Layer.effect(
    ArtifactProcessing,
    Effect.gen(function* () {
      const repository = yield* ArtifactRepository;
      const sessions = yield* ProfileSessions;

      return ArtifactProcessing.of({
        exhaust: Effect.fn("ArtifactProcessing.exhaust")(function* (job) {
          const message = "CSV profiling failed after three attempts.";
          yield* repository.markFailed({ artifactId: job.artifactId, message });
          yield* sessions.fail({ artifactId: job.artifactId, message });
        }),
        getProcessingState: sessions.getProcessingState,
        process: Effect.fn("ArtifactProcessing.process")(function* (job) {
          yield* sessions.initialize(job.artifactId);
          const current = yield* sessions.getProcessingState(job.artifactId);
          if (current.kind === "complete" || current.kind === "failed") return;

          yield* repository.markProcessing(job.artifactId);
          const bytes = yield* repository.getSourceBytes(job.artifactId);
          const reportProgress = yield* sessions.progressReporter(job.artifactId);
          const profile = yield* Effect.tryPromise({
            try: () => profileCsv(bytes, reportProgress),
            catch: (cause) =>
              cause instanceof ProfileFailure
                ? cause
                : new ProfileFailure({ cause, message: "The CSV could not be profiled." }),
          });
          yield* repository.markComplete({ artifactId: job.artifactId, profile });
          yield* sessions.complete(job.artifactId);
          yield* Effect.logInfo("CSV profile completed").pipe(
            Effect.annotateLogs({ artifactId: job.artifactId, rows: profile.rowCount }),
          );
        }),
      });
    }),
  );

  static readonly live = ArtifactProcessing.layer.pipe(
    Layer.provide(Layer.mergeAll(ArtifactRepository.layer, ProfileSessions.layer)),
  );
}
