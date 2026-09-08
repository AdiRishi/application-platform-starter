import { ArtifactId } from "@repo/contracts/artifacts";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { Api } from "../../src/api.ts";
import { workerCompatibility } from "../../src/cloudflare-config.ts";
import { Processor } from "../../src/processor.ts";

const probeId = Schema.decodeSync(ArtifactId)("00000000-0000-4000-8000-000000000000");

export default class ApiTestDriver extends Cloudflare.Worker<ApiTestDriver>()(
  "ApiTestDriver",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
  },
  Effect.gen(function* () {
    const api = yield* Cloudflare.Workers.bindWorker(Api);
    const processor = yield* Cloudflare.Workers.bindWorker(Processor);
    const fetch = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = new URL(request.url, "http://test").pathname;
      if (path === "/ready") {
        yield* api
          .getArtifact({ artifactId: probeId })
          .pipe(Effect.catchTag("ArtifactNotFound", () => Effect.void));
        yield* processor.getProcessingState(probeId);
        return HttpServerResponse.text("ready");
      }
      if (path === "/artifacts") return HttpServerResponse.jsonUnsafe(yield* api.listArtifacts());
      const artifactId = yield* Schema.decodeEffect(ArtifactId)(path.slice("/artifacts/".length));
      return HttpServerResponse.jsonUnsafe(yield* api.getArtifact({ artifactId }));
    }).pipe(
      Effect.catchTags({
        ArtifactNotFound: (error) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe(error, { status: 404 })),
        ArtifactsUnavailable: (error) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe(error, { status: 503 })),
        ProfileFailure: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
        SchemaError: () => Effect.succeed(HttpServerResponse.empty({ status: 400 })),
      }),
    );
    return { fetch };
  }),
) {}
