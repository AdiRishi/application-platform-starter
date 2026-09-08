import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, inject } from "vitest";

import Stack from "../alchemy.run.ts";
import { waitForWorker } from "./support/worker-readiness.ts";
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: !inject("live"),
});

const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ websiteUrl: Schema.String }))),
  ),
  { timeout: 600_000 },
);
afterAll(destroy(Stack), { timeout: 600_000 });

test(
  "the web Worker renders the document through its real API binding",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    yield* waitForWorker(websiteUrl);
    const response = yield* HttpClient.get(websiteUrl);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    const html = yield* response.text;
    expect(html).toContain("Inspect a CSV");
    expect(html).toContain("No profiles yet");
  }),
);

test(
  "the web Worker validates download routes",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const response = yield* HttpClient.get(`${websiteUrl}/artifacts/invalid/source`);
    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({
      code: "invalid_request",
      message: "The artifact id is invalid.",
    });
  }),
);

for (const request of [
  { name: "cross-site fetch metadata", headers: { "sec-fetch-site": "cross-site" } },
  { name: "a foreign origin", headers: { origin: "https://other.test" } },
  { name: "missing origin evidence", headers: {} },
]) {
  test(
    `server-function requests with ${request.name} are rejected before dispatch`,
    Effect.gen(function* () {
      const { websiteUrl } = yield* stack;
      const response = yield* HttpClient.get(`${websiteUrl}/_serverFn/csrf-probe`, {
        headers: request.headers,
      });
      expect(response.status).toBe(403);
      expect(yield* response.text).toBe("Forbidden");
    }),
  );
}

test(
  "the public application passes its Playwright suite",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    yield* waitForWorker(websiteUrl);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make("pnpm", ["exec", "playwright", "test"], {
        env: { APPLICATION_URL: websiteUrl },
        extendEnv: true,
        stdout: "inherit",
        stderr: "inherit",
      }),
    );
    expect(exitCode).toBe(0);
  }),
  { timeout: 240_000 },
);
