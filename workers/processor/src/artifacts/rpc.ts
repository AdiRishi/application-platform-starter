import { ProcessingStateUnavailable } from "@repo/contracts/schema";
import { ProcessorRpcs, rpcWebHandler } from "@repo/contracts/server";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";

import { processorRequest } from "../platform/worker-request.ts";
import { ArtifactProcessing } from "./service.ts";

const handlers = ProcessorRpcs.toLayer({
  getProcessingState: ({ artifactId }) =>
    Effect.gen(function* () {
      const processing = yield* ArtifactProcessing;
      return yield* processing.getProcessingState(artifactId);
    }).pipe(
      Effect.catchTag("ProfileFailure", (failure) =>
        Effect.logError("Profile session state could not be read", failure.cause).pipe(
          Effect.annotateLogs({ artifactId, message: failure.message }),
          Effect.andThen(Effect.fail(new ProcessingStateUnavailable({}))),
        ),
      ),
    ),
}).pipe(Layer.provide(ArtifactProcessing.live));

const rpc = rpcWebHandler(ProcessorRpcs, handlers);

export const handleRpcRequest = (
  request: Request,
  env: ProcessorEnv,
  executionContext: ExecutionContext,
) => rpc.handler(request, processorRequest.forRequest(env, executionContext));
