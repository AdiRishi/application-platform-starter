import type { WriteQueueClient } from "alchemy/Cloudflare/Queues";
import { Effect } from "effect";

import { StorageFailure } from "./errors.ts";
import { ArtifactRepository } from "./repository.ts";

export const dispatchProfiles = Effect.fn("Artifacts.dispatchProfiles")(function* (
  queue: Pick<WriteQueueClient, "send">,
) {
  const repository = yield* ArtifactRepository;
  const pending = yield* repository.pendingDelivery;
  yield* Effect.forEach(
    pending,
    ({ id }) =>
      queue.send({ artifactId: id }).pipe(
        Effect.mapError((cause) => new StorageFailure({ cause, operation: "send profile job" })),
        Effect.andThen(repository.markDispatched(id)),
        Effect.catch((failure) =>
          Effect.logError("Profile delivery failed", failure.cause).pipe(
            Effect.annotateLogs({ artifactId: id, operation: failure.operation }),
          ),
        ),
      ),
    { discard: true },
  );
});
