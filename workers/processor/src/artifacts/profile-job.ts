import { ProfileJob } from "@repo/contracts/artifacts";
import type { Message } from "alchemy/Cloudflare/Queues";
import { Effect, Function, Schema } from "effect";

import { InvalidProfileJob } from "./errors.ts";
import { ArtifactProcessing } from "./service.ts";

const parseJob = Function.flow(
  Schema.decodeUnknownEffect(ProfileJob),
  Effect.mapError((cause) => new InvalidProfileJob({ cause })),
);

export const handleMessage = Effect.fn("ArtifactProcessing.handleMessage")(
  function* (message: Message<unknown>, deadLetter: boolean) {
    const job = yield* parseJob(message.body);
    const processing = yield* ArtifactProcessing;
    yield* (deadLetter ? processing.exhaust(job) : processing.process(job)).pipe(
      Effect.tapError((failure) =>
        Effect.logError(
          deadLetter ? "Dead-letter handling failed" : "CSV profile attempt failed",
          failure.cause,
        ).pipe(Effect.annotateLogs({ artifactId: job.artifactId, message: failure.message })),
      ),
    );
  },
  (effect) =>
    effect.pipe(
      Effect.catchTag("InvalidProfileJob", () =>
        Effect.logWarning("Discarding an invalid profile queue message"),
      ),
    ),
);
