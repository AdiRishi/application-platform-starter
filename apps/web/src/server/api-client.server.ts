import { type ApiClient, ApiRpcs, clientOverBinding } from "@repo/contracts/client";
import { ApiError } from "@repo/contracts/schema";
import { env } from "cloudflare:workers";
import { Duration, Effect, Schema } from "effect";

const apiOrigin = "https://api.internal";
const decodeApiError = Schema.decodeUnknownPromise(ApiError);

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

export const requestApiJson = async <A, I>({
  init,
  path,
  schema,
}: {
  readonly init?: RequestInit;
  readonly path: string;
  readonly schema: Schema.Codec<A, I, never>;
}): Promise<A> => {
  const response = await fetchApi(path, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = await decodeApiError(body);
    throw new Error(error.message);
  }
  return Schema.decodeUnknownPromise(schema)(body);
};
