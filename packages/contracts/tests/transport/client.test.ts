import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { expect, test } from "vitest";

import { withRpcClient } from "../../src/transport/client.ts";
import { rpcHttpRouter, rpcWebHandler } from "../../src/transport/server.ts";

const Rpcs = RpcGroup.make(Rpc.make("read", { success: Schema.String }));

test("RPC routes compose with HTTP routes and forward explicit caller headers", async () => {
  const server = HttpRouter.toWebHandler(
    Layer.mergeAll(
      rpcHttpRouter(
        Rpcs,
        Rpcs.toLayer({
          read: () =>
            Effect.map(
              HttpServerRequest.HttpServerRequest,
              (request) => request.headers["x-caller"] ?? "anonymous",
            ),
        }),
      ),
      HttpRouter.add("GET", "/health", Effect.succeed(HttpServerResponse.text("ready"))),
    ),
  );
  try {
    const value = await Effect.runPromise(
      withRpcClient(
        Rpcs,
        {
          binding: { fetch: (input, init) => server.handler(new Request(input, init)) },
          service: "test",
          timeout: "1 second",
          headers: [["x-caller", "caller-123"]],
        },
        (client) => client.read(),
      ),
    );
    expect(value).toBe("caller-123");
    expect(await (await server.handler(new Request("http://test/health"))).text()).toBe("ready");
  } finally {
    await server.dispose();
  }
});

test("cancelling a caller interrupts the downstream RPC handler", async () => {
  const started = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const server = rpcWebHandler(
    Rpcs,
    Rpcs.toLayer({
      read: () =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => stopped.resolve())),
        ),
    }),
  );
  const controller = new AbortController();
  try {
    const result = Effect.runPromise(
      withRpcClient(
        Rpcs,
        {
          binding: { fetch: (input, init) => server.handler(new Request(input, init)) },
          service: "test",
          timeout: "2 seconds",
        },
        (client) => client.read(),
      ),
      { signal: controller.signal },
    ).then(
      () => "completed",
      () => "cancelled",
    );
    await started.promise;
    controller.abort();
    expect(await result).toBe("cancelled");
    await stopped.promise;
  } finally {
    await server.dispose();
  }
});

test("the RPC deadline covers a response body that never finishes", async () => {
  const controller = new AbortController();
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start: (value) => {
      body = value;
    },
  });
  try {
    const result = Effect.runPromise(
      withRpcClient(
        Rpcs,
        {
          binding: {
            fetch: async () =>
              new Response(stream, { headers: { "content-type": "application/json" } }),
          },
          service: "test",
          timeout: "50 millis",
        },
        (client) => client.read(),
      ),
      { signal: controller.signal },
    );
    await expect(result).rejects.toMatchObject({ _tag: "TimeoutError" });
  } finally {
    controller.abort();
    body?.close();
  }
});
