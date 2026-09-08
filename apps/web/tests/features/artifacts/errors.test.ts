import { ArtifactId, ArtifactNotFound, ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { ApiRpcs } from "@repo/contracts/artifacts/api";
import { withRpcClient } from "@repo/contracts/client";
import { rpcWebHandler } from "@repo/contracts/server";
import { Duration, Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { artifactRequestErrors } from "@/features/artifacts/errors";
import { runApiRequest } from "@/server/api-request";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("domain and availability errors cross RPC as safe browser errors", async () => {
  const server = rpcWebHandler(
    ApiRpcs,
    ApiRpcs.toLayer({
      getArtifact: () => Effect.fail(new ArtifactNotFound({ artifactId })),
      listArtifacts: () => Effect.fail(new ArtifactsUnavailable({})),
    }),
  );
  const options = {
    binding: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        server.handler(new Request(input, init)),
    },
    service: "test",
    timeout: Duration.seconds(1),
  };
  try {
    await expect(
      runApiRequest(
        withRpcClient(ApiRpcs, options, (client) =>
          client.getArtifact({ artifactId }).pipe(Effect.catchTags(artifactRequestErrors)),
        ),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: "AppRequestError",
      code: "not_found",
      message: "Artifact not found.",
    });
    await expect(
      runApiRequest(
        withRpcClient(ApiRpcs, options, (client) =>
          client
            .listArtifacts()
            .pipe(
              Effect.catchTag("ArtifactsUnavailable", artifactRequestErrors.ArtifactsUnavailable),
            ),
        ),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: "AppRequestError",
      code: "unavailable",
      message: "The service is temporarily unavailable. Please try again.",
    });
  } finally {
    await server.dispose();
  }
});
