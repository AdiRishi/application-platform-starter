import * as Test from "alchemy/Test/Vitest";
import { Effect, Schedule } from "effect";
import { HttpClient } from "effect/unstable/http";

export const waitForWorker = Effect.fn("Test.waitForWorker")(function* (url: string) {
  yield* Effect.gen(function* () {
    const response = yield* HttpClient.get(url);
    yield* response.text;
    if (response.status !== 200) return yield* new Test.WorkerNotReady({ status: response.status });
  }).pipe(
    Effect.retry({
      while: (error) =>
        error._tag === "WorkerNotReady"
          ? error.status === 404 || error.status >= 500
          : error.reason._tag === "TransportError",
      schedule: Schedule.spaced("500 millis"),
      times: 40,
    }),
    Effect.timeout("30 seconds"),
  );
});
