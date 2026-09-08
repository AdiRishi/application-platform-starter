import { BrowserCrypto } from "@effect/platform-browser";
import type { ArtifactId, ProcessingState, ProfileJob } from "@repo/contracts/artifacts";
import { Context, Crypto, Effect, Layer } from "effect";

import { ProfileSessions } from "../platform/profile-sessions.ts";
import { ProfileFailure } from "./errors.ts";
import { profileCsv } from "./profile-csv.ts";
import { ArtifactRepository } from "./repository.ts";

export class ArtifactProcessing extends Context.Service<
  ArtifactProcessing,
  {
    readonly exhaust: (job: ProfileJob) => Effect.Effect<void, ProfileFailure>;
    readonly getProcessingState: (
      artifactId: ArtifactId,
    ) => Effect.Effect<ProcessingState, ProfileFailure>;
    readonly process: (job: ProfileJob) => Effect.Effect<void, ProfileFailure>;
  }
>()("Processor/ArtifactProcessing") {
  static readonly layer = Layer.effect(
    ArtifactProcessing,
    Effect.gen(function* () {
      const repository = yield* ArtifactRepository;
      const sessions = yield* ProfileSessions;
      const crypto = yield* Crypto.Crypto;

      return ArtifactProcessing.of({
        exhaust: Effect.fn("ArtifactProcessing.exhaust")(function* (job) {
          const message = "CSV profiling exhausted its retries.";
          yield* repository.markFailed({ artifactId: job.artifactId, message });
        }),
        getProcessingState: sessions.getProcessingState,
        process: Effect.fn("ArtifactProcessing.process")(function* (job) {
          const active = yield* repository.markProcessing(job.artifactId);
          if (!active) return;
          const bytes = yield* repository.getSourceBytes(job.artifactId);
          const parsed = yield* Effect.result(
            profileCsv(bytes, (rowsProcessed, totalRows) =>
              sessions.reportProgress({ artifactId: job.artifactId, rowsProcessed, totalRows }),
            ).pipe(Effect.provideService(Crypto.Crypto, crypto)),
          );
          if (parsed._tag === "Failure") {
            yield* repository.markFailed({
              artifactId: job.artifactId,
              message: parsed.failure.message,
            });
            return;
          }
          const profile = parsed.success;
          yield* repository.markComplete({ artifactId: job.artifactId, profile });
          yield* Effect.logInfo("CSV profile completed").pipe(
            Effect.annotateLogs({ artifactId: job.artifactId, rows: profile.rowCount }),
          );
        }),
      });
    }),
  );

  static readonly live = ArtifactProcessing.layer.pipe(
    Layer.provide(
      Layer.mergeAll(ArtifactRepository.layer, ProfileSessions.layer, BrowserCrypto.layer),
    ),
  );
}
