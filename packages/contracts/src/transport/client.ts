import { Duration, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/unstable/rpc";

import { rpcPath } from "./protocol.ts";

export type ClientFor<Group> = RpcClient.RpcClient<
  RpcGroup.Rpcs<Group>,
  RpcClientError.RpcClientError
>;

export interface ServiceBinding {
  readonly fetch: typeof globalThis.fetch;
}

export const withRpcClient = <Rpcs extends Rpc.Any, A, E>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: {
    readonly binding: ServiceBinding;
    readonly service: string;
    readonly timeout: Duration.Input;
    readonly headers?: ReadonlyArray<readonly [string, string]>;
  },
  use: (client: RpcClient.RpcClient<Rpcs, RpcClientError.RpcClientError>) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const httpClient = Layer.effect(
        HttpClient.HttpClient,
        Effect.map(HttpClient.HttpClient, (client) =>
          HttpClient.filterStatusOk(
            HttpClient.mapRequest(client, (request) =>
              HttpClientRequest.setHeaders(request, options.headers ?? []),
            ),
          ),
        ),
      ).pipe(
        Layer.provide(
          FetchHttpClient.layer.pipe(
            Layer.provide(
              Layer.succeed(FetchHttpClient.Fetch)(options.binding.fetch.bind(options.binding)),
            ),
          ),
        ),
      );
      const client = yield* RpcClient.make(group).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({ url: `http://${options.service}.internal${rpcPath}` }).pipe(
            Layer.provide(RpcSerialization.layerJson),
            Layer.provide(httpClient),
          ),
        ),
      );
      return yield* use(client);
    }),
  ).pipe(Effect.timeout(options.timeout));
