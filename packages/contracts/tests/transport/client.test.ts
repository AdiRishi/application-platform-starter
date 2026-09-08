import { expect, it } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import { Cause, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { withRpcClient } from "../../src/transport/client.ts";
import { rpcHttpRouter, rpcWebHandler } from "../../src/transport/server.ts";

const Rpcs = RpcGroup.make(Rpc.make("read", { success: Schema.String }));

it.effect("RPC routes compose with HTTP routes and forward explicit caller headers", () =>
  Effect.gen(function* () {
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
    yield* Effect.addFinalizer(() => Effect.promise(() => server.dispose()));
    const value = yield* withRpcClient(
      Rpcs,
      {
        binding: { fetch: (input, init) => server.handler(new Request(input, init)) },
        service: "test",
        timeout: "1 second",
        headers: [["x-caller", "caller-123"]],
      },
      (client) => client.read(),
    );
    expect(value).toBe("caller-123");
    const health = yield* Effect.promise(() =>
      server.handler(new Request("http://test/health")).then((response) => response.text()),
    );
    expect(health).toBe("ready");
  }),
);

it("cancelling a caller interrupts the downstream RPC handler", async () => {
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

it.effect("the RPC deadline covers a response body that never finishes", () =>
  Effect.gen(function* () {
    const reading = Promise.withResolvers<void>();
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          body = controller;
        },
        pull: () => {
          reading.resolve();
        },
      },
      { highWaterMark: 0 },
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => body?.close()));
    const fiber = yield* withRpcClient(
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
    ).pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => reading.promise);
    yield* TestClock.adjust("50 millis");
    assertFailure(yield* Fiber.join(fiber), new Cause.TimeoutError());
  }),
);
