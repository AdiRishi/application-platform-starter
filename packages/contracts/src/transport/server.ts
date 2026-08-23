import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { rpcPath } from "./protocol";

export const rpcWebHandler = <Rpcs extends Rpc.Any, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, never, R>,
) =>
  HttpRouter.toWebHandler(
    HttpRouter.add(
      "POST",
      rpcPath,
      RpcServer.toHttpEffect(group).pipe(
        Effect.provide(handlers),
        Effect.provide(RpcSerialization.layerJson),
        Effect.flatMap((handler) => handler),
      ),
    ),
  );
