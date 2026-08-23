import { ProcessorRpcFailure, ProcessorRpcs } from "@repo/contracts";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

const handlers = (env: ProcessorEnv) =>
  ProcessorRpcs.toLayer({
    getProcessingState: ({ artifactId }) => {
      const session = env.PROFILE_SESSIONS.getByName(artifactId);
      return Effect.tryPromise({
        try: () => session.getState(),
        catch: () => new ProcessorRpcFailure({ message: "The profile session could not be read." }),
      }).pipe(Effect.map(({ state }) => state));
    },
  });

export const processorRpcHandler = (env: ProcessorEnv) =>
  HttpEffect.toWebHandler(
    RpcServer.toHttpEffect(ProcessorRpcs).pipe(
      Effect.flatMap((handleRequest) => handleRequest),
      Effect.provide(Layer.mergeAll(handlers(env), RpcSerialization.layerJson)),
      Effect.scoped,
    ),
  );
