import { ArtifactId } from "@repo/contracts";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("a profile session migrates once and restores state after eviction", async () => {
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await session.initialize(artifactId);
  await session.progress(12, 20);

  await runInDurableObject<DurableObject, void>(session, (_instance, state) => {
    state.storage.sql.exec("DELETE FROM _sql_schema_migrations");
  });
  await evictDurableObject(session);
  await expect(session.getState()).resolves.toStrictEqual({
    state: { kind: "processing", rowsProcessed: 12, totalRows: 20 },
  });

  const versions = await runInDurableObject<DurableObject, number[]>(session, (_instance, state) =>
    state.storage.sql
      .exec<{ version: number }>("SELECT version FROM _sql_schema_migrations ORDER BY version")
      .toArray()
      .map(({ version }) => version),
  );
  expect(versions).toStrictEqual([1]);
});
