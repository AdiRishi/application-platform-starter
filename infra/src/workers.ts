import { Effect } from "effect";

import ApiLive, { Api } from "./api.ts";
import ProcessorLive, { Processor } from "./processor.ts";

export const workerGraph = Effect.gen(function* () {
  const processor = yield* Processor;
  const api = yield* Api;
  return { api, processor };
}).pipe(Effect.provide([ApiLive, ProcessorLive]));

export type Workers = Effect.Success<typeof workerGraph>;
