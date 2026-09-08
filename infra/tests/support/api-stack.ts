import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { workerGraph } from "../../src/workers.ts";
import Driver from "../fixtures/api-driver.ts";

export const apiStack = Effect.gen(function* () {
  const { api } = yield* workerGraph;
  const driver = yield* Driver;
  return { apiUrl: api.url.as<string>(), driverUrl: driver.url.as<string>() };
});

export const ApiStack = Alchemy.Stack(
  "ApiTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  apiStack,
);
