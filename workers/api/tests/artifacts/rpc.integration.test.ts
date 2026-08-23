import { ApiRpcs, clientOverBinding } from "@repo/contracts/client";
import { ArtifactSummary } from "@repo/contracts/schema";
import { exports } from "cloudflare:workers";
import { Duration, Effect, Schema } from "effect";
import { expect, test } from "vitest";

test("structured artifact reads use the API Worker RPC contract", async () => {
  const form = new FormData();
  form.set(
    "file",
    new File(["date,description,amount\n2026-08-01,Coffee,-4.80\n"], "transactions.csv", {
      type: "text/csv",
    }),
  );
  const upload = await exports.default.fetch("https://api.test/api/artifacts", {
    body: form,
    method: "POST",
  });
  const artifact = Schema.decodeUnknownSync(ArtifactSummary)(await upload.json());

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(ApiRpcs, {
        binding: exports.default,
        service: "api.test",
        timeout: Duration.seconds(5),
      });
      const artifacts = yield* client.listArtifacts();
      const detail = yield* client.getArtifact({ artifactId: artifact.id });
      return { artifacts, detail };
    }).pipe(Effect.scoped),
  );

  expect(result.artifacts).toStrictEqual([artifact]);
  expect(result.detail).toStrictEqual(artifact);
});
