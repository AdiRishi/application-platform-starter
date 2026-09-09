import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { ArtifactsDatabase } from "../src/data-plane.ts";

const id = "11111111-1111-4111-8111-111111111111";
const options = { providers: Cloudflare.providers(), state: Alchemy.localState() };
const Legacy = Alchemy.Stack(
  "DatabaseMigrationTest",
  options,
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.Database("ArtifactsDatabase", {
      migrations: "./tests/fixtures/legacy-migrations",
    });
    const seed = Alchemy.Action(
      "SeedLegacy",
      Effect.gen(function* () {
        const db = yield* Cloudflare.D1.QueryDatabase(database);
        return () =>
          db
            .prepare(
              "INSERT INTO artifacts (id,file_name,object_key,content_type,byte_size,status,created_at) VALUES (?, 'original.csv', 'original.csv', 'text/csv', 9, 'queued', '2026-08-22T00:00:00Z')",
            )
            .bind(id)
            .run();
      }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseLocal)),
    );
    yield* seed(undefined);
    return { databaseId: database.databaseId };
  }),
);
const Current = Alchemy.Stack(
  "DatabaseMigrationTest",
  options,
  Effect.gen(function* () {
    const database = yield* ArtifactsDatabase;
    const inspect = Alchemy.Action(
      "ReadMigrated",
      Effect.gen(function* () {
        const db = yield* Cloudflare.D1.QueryDatabase(database);
        return () =>
          db
            .prepare("SELECT id, file_name, status, dispatched_at FROM artifacts WHERE id = ?")
            .bind(id)
            .first();
      }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseLocal)),
    );
    return { databaseId: database.databaseId, artifact: yield* inspect(undefined) };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
});
const legacy = beforeAll(deploy(Legacy));
afterAll(destroy(Current));

test(
  "the delivery migration preserves existing artifacts and makes queued work dispatchable",
  Effect.gen(function* () {
    const previous = yield* legacy;
    const { artifact, databaseId } = yield* deploy(Current);
    expect(databaseId).toBe(previous.databaseId);
    expect(artifact).toEqual({
      id,
      file_name: "original.csv",
      status: "queued",
      dispatched_at: null,
    });
  }),
);
