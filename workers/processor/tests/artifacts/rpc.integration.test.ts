import { ArtifactId } from "@repo/contracts/artifacts";
import { ProcessorRpcs } from "@repo/contracts/artifacts/processor";
import { withRpcClient } from "@repo/contracts/client";
import { env, exports } from "cloudflare:workers";
import { Duration, Effect, Schema } from "effect";
import { expect, test } from "vitest";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("the processor serves its shared RPC contract over its Worker handler", async () => {
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await session.progress(12, 20);

  const state = await Effect.runPromise(
    withRpcClient(
      ProcessorRpcs,
      { binding: exports.default, service: "processor.test", timeout: Duration.seconds(5) },
      (client) => client.getProcessingState({ artifactId }),
    ),
  );

  expect(state).toStrictEqual({ kind: "processing", rowsProcessed: 12, totalRows: 20 });
});
