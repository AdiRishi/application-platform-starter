import { type ApiClient, ApiRpcs, clientOverBinding } from "@repo/contracts/client";
import { env } from "cloudflare:workers";
import { Duration, Effect } from "effect";

const apiOrigin = "https://api.internal";

export const fetchApi = (path: string, init?: RequestInit) =>
  env.API.fetch(new Request(new URL(path, apiOrigin), init));

export const callApiRpc = <A, E>(use: (client: ApiClient) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(ApiRpcs, {
        binding: env.API,
        service: "api",
        timeout: Duration.seconds(10),
      });
      return yield* use(client);
    }).pipe(Effect.scoped),
  );
