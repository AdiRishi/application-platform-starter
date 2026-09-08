import { ArtifactId, ArtifactNotFound, ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { artifactRequestErrors } from "@/features/artifacts/errors";
import { runApiRequest } from "@/server/api-request";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

for (const scenario of [
  {
    failure: new ArtifactNotFound({ artifactId }),
    code: "not_found",
    message: "Artifact not found.",
  },
  {
    failure: new ArtifactsUnavailable({}),
    code: "unavailable",
    message: "The service is temporarily unavailable. Please try again.",
  },
]) {
  test(`${scenario.failure._tag} becomes a safe browser error`, async () => {
    await expect(
      runApiRequest(
        Effect.fail(scenario.failure).pipe(Effect.catchTags(artifactRequestErrors)),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: "AppRequestError",
      code: scenario.code,
      message: scenario.message,
    });
  });
}
