import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Schedule, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { expect } from "vitest";

import { ArtifactsDatabase } from "../src/data-plane.ts";
import DispatchWorker from "./fixtures/dispatch-worker.ts";
import { waitForWorker } from "./support/worker-readiness.ts";

const Stack = Alchemy.Stack(
  "DispatchRecoveryTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* DispatchWorker;
    const db = yield* ArtifactsDatabase;
    const prepare = Alchemy.Action(
      "PrepareDeliveries",
      Effect.gen(function* () {
        const database = yield* Cloudflare.D1.QueryDatabase(db);
        return () =>
          database.exec("CREATE TABLE IF NOT EXISTS deliveries (artifact_id TEXT PRIMARY KEY)");
      }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseLocal)),
    );
    yield* prepare(undefined);
    return { url: worker.url.as<string>() };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
});
const stack = beforeAll(deploy(Stack).pipe(Effect.tap(({ url }) => waitForWorker(`${url}/ready`))));
afterAll(destroy(Stack));

const Delivery = Schema.Struct({ pending: Schema.Boolean, delivered: Schema.Boolean });
for (const mode of ["rejected", "ambiguous"]) {
  const id = crypto.randomUUID();
  test(
    `${mode} queue sends preserve pending work and recovery delivers it`,
    Effect.gen(function* () {
      const { url } = yield* stack;
      const failed = yield* HttpClient.post(`${url}/${mode}/${id}`);
      expect(failed.status).toBe(200);
      expect(yield* failed.json).toMatchObject({ pending: true });
      const dispatched = yield* HttpClient.post(`${url}/dispatch`);
      expect(dispatched.status).toBe(204);
      const state = yield* HttpClient.get(`${url}/state/${id}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Delivery)),
        Effect.repeat({
          schedule: Schedule.spaced("200 millis"),
          until: (state) => state.delivered,
          times: 50,
        }),
      );
      expect(state).toEqual({ pending: false, delivered: true });
      const repeated = yield* HttpClient.post(`${url}/dispatch`);
      expect(repeated.status).toBe(204);
      const after = yield* HttpClient.get(`${url}/state/${id}`);
      expect(yield* after.json).toEqual({ pending: false, delivered: true });
    }),
  );
}
