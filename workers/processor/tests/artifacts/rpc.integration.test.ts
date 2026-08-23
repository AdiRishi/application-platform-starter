import { ArtifactId, ProcessorRpcs } from "@repo/contracts";
import { env, exports } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { expect, test } from "vitest";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

const workerHttpClient = HttpClient.make((request, url, signal) => {
  if (request.body._tag !== "Uint8Array") {
    return Effect.die(new Error(`Unexpected RPC body ${request.body._tag}`));
  }
  const body = request.body.body;
  return Effect.tryPromise({
    try: () =>
      exports.default.fetch(
        new Request(url, {
          body,
          headers: request.headers,
          method: request.method,
          signal,
        }),
      ),
    catch: (cause) =>
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ cause, request }),
      }),
  }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response)));
});

test("the processor serves its shared RPC contract over HTTP", async () => {
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await session.initialize(artifactId);
  await session.progress(12, 20);

  const protocol = RpcClient.layerProtocolHttp({ url: "https://processor.test/rpc" }).pipe(
    Layer.provideMerge(RpcSerialization.layerJson),
    Layer.provideMerge(Layer.succeed(HttpClient.HttpClient, workerHttpClient)),
  );
  const state = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(ProcessorRpcs);
      return yield* client.getProcessingState({ artifactId });
    }).pipe(Effect.provide(protocol), Effect.scoped),
  );

  expect(state).toStrictEqual({ kind: "processing", rowsProcessed: 12, totalRows: 20 });
});
