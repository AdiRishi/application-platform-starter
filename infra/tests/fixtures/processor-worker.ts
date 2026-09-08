import { BrowserCrypto } from "@effect/platform-browser";
import { ArtifactId } from "@repo/contracts/artifacts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as SQL from "alchemy/SQL/D1";
import { Crypto, Effect, Layer, PlatformError, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { handleMessage } from "../../../workers/processor/src/artifacts/profile-job.ts";
import { ArtifactRepository } from "../../../workers/processor/src/artifacts/repository.ts";
import { ArtifactProcessing } from "../../../workers/processor/src/artifacts/service.ts";
import { ProfileSessions } from "../../../workers/processor/src/platform/profile-sessions.ts";
import { workerCompatibility } from "../../src/cloudflare-config.ts";
import { ArtifactsBucket, ArtifactsDatabase } from "../../src/data-plane.ts";
import { CsvProfileSession } from "../../src/profile-session.ts";

export default Cloudflare.Worker(
  "ProcessorRecoveryWorker",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
  },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1.QueryDatabase(yield* ArtifactsDatabase);
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(yield* ArtifactsBucket);
    const sessions = yield* CsvProfileSession;
    const crypto = yield* Crypto.Crypto;
    const repository = yield* ArtifactRepository.pipe(
      Effect.provide(ArtifactRepository.layer(bucket).pipe(Layer.provide(SQL.D1Layer(db)))),
    );
    const fetch = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://test");
      if (url.pathname === "/ready") return HttpServerResponse.text("ready");
      const [operation, rawId] = url.pathname.slice(1).split("/");
      const artifactId = yield* Schema.decodeUnknownEffect(ArtifactId)(rawId);
      if (operation === "record") {
        return HttpServerResponse.jsonUnsafe(
          yield* db
            .prepare(
              "SELECT status, profile_json, completed_at, error_message FROM artifacts WHERE id = ?",
            )
            .bind(artifactId)
            .first(),
        );
      }
      if (operation === "source") {
        if (request.method === "DELETE") yield* bucket.delete(`source/${artifactId}`);
        else yield* bucket.put(`source/${artifactId}`, yield* request.text);
        return HttpServerResponse.empty({ status: 204 });
      }
      const processing = yield* ArtifactProcessing.pipe(
        Effect.provide(
          ArtifactProcessing.layer.pipe(
            Layer.provide([
              Layer.succeed(ArtifactRepository, repository),
              Layer.succeed(Crypto.Crypto, {
                ...crypto,
                digest: (...args: Parameters<typeof crypto.digest>) =>
                  url.searchParams.has("failDigest")
                    ? Effect.fail(
                        PlatformError.systemError({
                          _tag: "Unknown",
                          module: "Crypto",
                          method: "digest",
                        }),
                      )
                    : crypto.digest(...args),
              }),
              ProfileSessions.layer({
                getByName: (name) => {
                  const session = sessions.getByName(name);
                  return {
                    getState: session.getState,
                    progress: url.searchParams.has("failProgress")
                      ? () => Effect.die(new Error("Progress transport unavailable"))
                      : session.progress,
                  };
                },
              }),
            ]),
          ),
        ),
      );
      yield* handleMessage(
        { body: url.searchParams.has("invalid") ? { artifactId: "invalid" } : { artifactId } },
        operation === "exhaust",
      ).pipe(Effect.provideService(ArtifactProcessing, processing));
      return HttpServerResponse.empty({ status: 204 });
    }).pipe(
      Effect.catchTags({
        ProfileFailure: (error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe({ message: error.message }, { status: 503 }),
          ),
        SchemaError: () => Effect.succeed(HttpServerResponse.empty({ status: 400 })),
        R2Error: () => Effect.succeed(HttpServerResponse.empty({ status: 500 })),
      }),
    );
    return { fetch };
  }).pipe(
    Effect.provide([
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.R2.ReadWriteBucketBinding,
      BrowserCrypto.layer,
    ]),
  ),
);
