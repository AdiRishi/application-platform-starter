import { ArtifactId } from "@repo/contracts/artifacts";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("progress survives eviction and duplicate attempts cannot move it backward", async () => {
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await expect(session.getState()).resolves.toEqual({ state: { kind: "queued" } });
  await session.progress(12, 20);
  await evictDurableObject(session);
  await session.progress(2, 20);
  await expect(session.getState()).resolves.toEqual({
    state: { kind: "processing", rowsProcessed: 12, totalRows: 20 },
  });
});
