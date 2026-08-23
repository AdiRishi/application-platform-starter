import { clientOverBinding, ProcessorRpcs } from "@repo/contracts/client";
import { ArtifactId } from "@repo/contracts/schema";
import { env, exports } from "cloudflare:workers";
import { Duration, Effect, Schema } from "effect";
import { expect, test } from "vitest";

const artifactId = Schema.decodeUnknownSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("the processor serves its shared RPC contract over its Worker handler", async () => {
  const session = env.PROFILE_SESSIONS.getByName(artifactId);
  await session.initialize(artifactId);
  await session.progress(12, 20);

  const state = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(ProcessorRpcs, {
        binding: exports.default,
        service: "processor.test",
        timeout: Duration.seconds(5),
      });
      return yield* client.getProcessingState({ artifactId });
    }).pipe(Effect.scoped),
  );

  expect(state).toStrictEqual({ kind: "processing", rowsProcessed: 12, totalRows: 20 });
});
