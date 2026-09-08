import { AppRequestError } from "@repo/contracts/app";
import type { ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { Effect } from "effect";

export const artifactRequestErrors = {
  ArtifactNotFound: () => Effect.fail(new AppRequestError("not_found", "Artifact not found.")),
  ArtifactsUnavailable: (failure: ArtifactsUnavailable) =>
    Effect.logError("Artifact request failed", failure).pipe(
      Effect.andThen(
        Effect.fail(
          new AppRequestError(
            "unavailable",
            "The service is temporarily unavailable. Please try again.",
          ),
        ),
      ),
    ),
};
