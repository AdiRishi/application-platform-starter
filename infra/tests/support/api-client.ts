import { ArtifactDetail, type ArtifactId, ArtifactsUnavailable } from "@repo/contracts/artifacts";
import { Effect, Schedule, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";

export const readArtifact = Effect.fn(
  function* (driverUrl: string, artifactId: ArtifactId) {
    const response = yield* HttpClient.get(`${driverUrl}/artifacts/${artifactId}`);
    if (response.status === 503) {
      return yield* Schema.decodeUnknownEffect(ArtifactsUnavailable)(yield* response.json).pipe(
        Effect.flatMap(Effect.fail),
      );
    }
    return yield* Schema.decodeUnknownEffect(ArtifactDetail)(yield* response.json);
  },
  Effect.retry({
    while: (error) =>
      error._tag === "ArtifactsUnavailable" ||
      (error._tag === "HttpClientError" && error.reason._tag === "TransportError"),
    schedule: Schedule.spaced("200 millis"),
    times: 2,
  }),
);
