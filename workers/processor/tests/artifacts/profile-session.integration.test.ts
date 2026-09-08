import { ArtifactId } from "@repo/contracts/artifacts";
import { Schema } from "effect";
import { expect } from "vitest";

import { test } from "../support/runtime.ts";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("progress survives eviction and duplicate attempts cannot move it backward", async ({
  runtime,
}) => {
  const session = runtime.session(artifactId);
  expect(await session.getState()).toMatchObject({ state: { kind: "queued" } });
  await session.progress(12, 20);
  await runtime.miniflare.unsafeEvictDurableObject("processor-test", "CsvProfileSession", {
    name: artifactId,
  });
  await session.progress(2, 20);
  expect(await session.getState()).toMatchObject({
    state: { kind: "processing", rowsProcessed: 12, totalRows: 20 },
  });
});
