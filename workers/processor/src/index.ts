import { BrowserCrypto } from "@effect/platform-browser";
import type { processorBindings } from "@repo/infra/worker-bindings";
import type { Message } from "alchemy/Cloudflare/Queues";
import { Effect, Layer } from "effect";

import { handleMessage } from "./artifacts/profile-job.ts";
import { ArtifactProcessing } from "./artifacts/service.ts";
import { ArtifactClient } from "./platform/artifact-client.ts";
import { ProfileSessions } from "./platform/profile-sessions.ts";

export const processor = Effect.fn("Processor.initialize")(function* (
  bindings: Effect.Success<ReturnType<typeof processorBindings>>,
) {
  const processing = yield* ArtifactProcessing.pipe(
    Effect.provide(
      ArtifactProcessing.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            ArtifactClient.layer(bindings.api),
            ProfileSessions.layer(bindings.sessions),
            BrowserCrypto.layer,
          ),
        ),
      ),
    ),
  );

  return {
    getProcessingState: processing.getProcessingState,
    process: (message: Message<unknown>) =>
      handleMessage(message, false).pipe(Effect.provideService(ArtifactProcessing, processing)),
    exhaust: (message: Message<unknown>) =>
      handleMessage(message, true).pipe(Effect.provideService(ArtifactProcessing, processing)),
  };
});
