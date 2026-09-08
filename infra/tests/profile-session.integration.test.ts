import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { expect } from "vitest";

import SessionWorker from "./fixtures/profile-session-worker.ts";
import { waitForWorker } from "./support/worker-readiness.ts";

const Stack = Alchemy.Stack(
  "ProfileSessionTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* SessionWorker;
    return { url: worker.url.as<string>() };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
});
const stack = beforeAll(deploy(Stack));
afterAll(destroy(Stack));

test(
  "Durable Object RPC preserves progress across requests and duplicate attempts cannot move it backward",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const target = `${url}/11111111-1111-4111-8111-111111111111`;
    yield* waitForWorker(target);
    const initial = yield* HttpClient.get(target);
    expect(yield* initial.json).toEqual({ state: { kind: "queued" } });
    const first = yield* HttpClient.post(target, {
      body: HttpBody.jsonUnsafe({ rowsProcessed: 12, totalRows: 20 }),
    });
    expect(yield* first.json).toEqual({
      state: { kind: "processing", rowsProcessed: 12, totalRows: 20 },
    });
    const duplicate = yield* HttpClient.post(target, {
      body: HttpBody.jsonUnsafe({ rowsProcessed: 2, totalRows: 20 }),
    });
    expect(yield* duplicate.json).toEqual({
      state: { kind: "processing", rowsProcessed: 12, totalRows: 20 },
    });
    const stored = yield* HttpClient.get(target);
    expect(yield* stored.json).toEqual({
      state: { kind: "processing", rowsProcessed: 12, totalRows: 20 },
    });
  }),
);
