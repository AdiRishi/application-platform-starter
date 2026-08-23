import { ProcessorRpcs } from "@repo/contracts";
import { Context, Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { RpcClient, RpcGroup, RpcSerialization } from "effect/unstable/rpc";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";

const serviceBindingHttpClient = (fetcher: Fetcher): HttpClient.HttpClient =>
  HttpClient.make((request, url, signal) => {
    if (request.body._tag !== "Uint8Array") {
      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.EncodeError({
            cause: new Error(`Unsupported RPC body ${request.body._tag}`),
            request,
          }),
        }),
      );
    }
    const body = request.body.body;
    return Effect.tryPromise({
      try: () =>
        fetcher.fetch(
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

export class ProcessorClient extends Context.Service<
  ProcessorClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof ProcessorRpcs>, RpcClientError>
>()("Api/ProcessorClient") {
  static layer(fetcher: Fetcher) {
    const protocol = RpcClient.layerProtocolHttp({ url: "https://processor.internal/rpc" }).pipe(
      Layer.provideMerge(RpcSerialization.layerJson),
      Layer.provideMerge(Layer.succeed(HttpClient.HttpClient, serviceBindingHttpClient(fetcher))),
    );
    return Layer.effect(ProcessorClient)(RpcClient.make(ProcessorRpcs)).pipe(
      Layer.provide(protocol),
    );
  }
}
