import type { ProfileJob } from "@repo/contracts/artifacts";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect } from "effect";

import { apiRequest } from "../platform/worker-request.ts";
import { StorageFailure } from "./errors.ts";
import { ArtifactRepository } from "./repository.ts";

export const dispatchProfiles = Effect.fn("Artifacts.dispatchProfiles")(function* (
  queue: Pick<Queue<ProfileJob>, "send">,
) {
  const repository = yield* ArtifactRepository;
  const pending = yield* repository.pendingDelivery;
  yield* Effect.forEach(
    pending,
    ({ id }) =>
      Effect.tryPromise({
        try: () => queue.send({ artifactId: id }),
        catch: (cause) => new StorageFailure({ cause, operation: "send profile job" }),
      }).pipe(
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

export const handleProfileDispatch = (
  env: ApiEnv,
  executionContext: ExecutionContext,
): Promise<void> =>
  Effect.runPromise(
    dispatchProfiles(env.PROFILE_JOBS).pipe(
      Effect.provide(ArtifactRepository.layer),
      Effect.provideService(apiRequest.service, { env, executionContext }),
      Effect.catch((failure) =>
        Effect.logError("Profile dispatch failed", failure.cause).pipe(
          Effect.annotateLogs({ operation: failure.operation }),
        ),
      ),
    ),
  );
