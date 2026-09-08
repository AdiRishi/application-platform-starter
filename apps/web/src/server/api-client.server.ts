import { ApiRpcs } from "@repo/contracts/artifacts/api";
import { withRpcClient, type ClientFor } from "@repo/contracts/client";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Duration, Effect } from "effect";

import { runApiRequest } from "./api-request";

const apiOrigin = "https://api.internal";

export const fetchApi = (path: string, init?: RequestInit) =>
  env.API.fetch(new Request(new URL(path, apiOrigin), init));

export const callApiRpc = <A, E>(
  use: (client: ClientFor<typeof ApiRpcs>) => Effect.Effect<A, E>,
): Promise<A> =>
  runApiRequest(
    withRpcClient(
      ApiRpcs,
      {
        binding: env.API,
        service: "api",
        timeout: Duration.seconds(10),
      },
      use,
    ),
    getRequest().signal,
  );
