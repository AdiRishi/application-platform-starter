import { Context, Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";
import { expect, test } from "vitest";

import { withRpcClient } from "../../src/transport/client.ts";
import { rpcWebHandler } from "../../src/transport/server.ts";

class Caller extends Context.Service<Caller, string>()("Test/Caller") {}
class CallerMiddleware extends RpcMiddleware.Service<CallerMiddleware, { provides: Caller }>()(
  "Test/CallerMiddleware",
  { error: Schema.Never },
) {}

test("RPC middleware supplies caller context to a handler", async () => {
  const group = RpcGroup.make(Rpc.make("caller", { success: Schema.String })).middleware(
    CallerMiddleware,
  );
  const server = rpcWebHandler(
    group,
    Layer.mergeAll(
      group.toLayer({
        caller: () => Effect.service(Caller),
      }),
      Layer.succeed(CallerMiddleware)(
        CallerMiddleware.of((effect, options) =>
          Effect.provideService(effect, Caller, options.headers["x-caller"] ?? "anonymous"),
        ),
      ),
    ),
  );
  try {
    const caller = await Effect.runPromise(
      withRpcClient(
        group,
        {
          binding: { fetch: (input, init) => server.handler(new Request(input, init)) },
          service: "test",
          timeout: "1 second",
          headers: [["x-caller", "caller-123"]],
        },
        (client) => client.caller(),
      ),
    );
    expect(caller).toBe("caller-123");
  } finally {
    await server.dispose();
  }
});

class RequestValue extends Context.Service<RequestValue, { readonly value: string }>()(
  "Test/RequestValue",
) {}

test("RPC handler layers resolve dependencies separately for each request", async () => {
  const group = RpcGroup.make(Rpc.make("value", { success: Schema.String }));
  const server = rpcWebHandler(
    group,
    group.toLayer(
      Effect.gen(function* () {
        const { value } = yield* RequestValue;
        return { value: () => Effect.succeed(value) };
      }),
    ),
  );
  try {
    const values = await Promise.all(
      ["first request", "second request"].map((value) =>
        Effect.runPromise(
          withRpcClient(
            group,
            {
              binding: {
                fetch: (input, init) =>
                  server.handler(new Request(input, init), Context.make(RequestValue, { value })),
              },
              service: "test",
              timeout: "1 second",
            },
            (client) => client.value(),
          ),
        ),
      ),
    );
    expect(values).toEqual(["first request", "second request"]);
  } finally {
    await server.dispose();
  }
});
