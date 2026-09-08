import { ArtifactId } from "@repo/contracts/artifacts";
import { Schema } from "effect";
import { expect } from "vitest";

import { test } from "./support/runtime.ts";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("the processor serves processing state over native Worker RPC", async ({ runtime }) => {
  await runtime.session(artifactId).progress(12, 20);
  const state = await runtime.processor.getProcessingState(artifactId);
  expect(state).toMatchObject({ kind: "processing", rowsProcessed: 12, totalRows: 20 });
});
