import { ArtifactId, ProfileJob } from "@repo/contracts/artifacts";
import * as Cloudflare from "alchemy/Cloudflare";
import { SendError } from "alchemy/Cloudflare/Queues";
import * as SQL from "alchemy/SQL/D1";
import { Effect, Layer, Schema, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { dispatchProfiles } from "../../../workers/api/src/artifacts/dispatch.ts";
import { ArtifactRepository } from "../../../workers/api/src/artifacts/repository.ts";
import { workerCompatibility } from "../../src/cloudflare-config.ts";
import { ArtifactsBucket, ArtifactsDatabase } from "../../src/data-plane.ts";

export default Cloudflare.Worker(
  "DispatchTestWorker",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
  },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1.QueryDatabase(yield* ArtifactsDatabase);
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(yield* ArtifactsBucket);
    const queueResource = yield* Cloudflare.Queues.Queue("DispatchProbe");
    const queue = yield* Cloudflare.Queues.WriteQueue(queueResource);
    const repository = yield* ArtifactRepository.pipe(
      Effect.provide(ArtifactRepository.layer(bucket).pipe(Layer.provide(SQL.D1Layer(db)))),
    );
    yield* Cloudflare.Queues.consumeQueueMessages(queueResource, { batchSize: 1 }, (messages) =>
      Stream.runForEach(messages, (message) =>
        Effect.gen(function* () {
          const job = yield* Schema.decodeUnknownEffect(ProfileJob)(message.body);
          yield* db
            .prepare("INSERT OR IGNORE INTO deliveries (artifact_id) VALUES (?)")
            .bind(job.artifactId)
            .run();
        }),
      ),
    );
    const dispatch = (sender: Pick<typeof queue, "send">) =>
      dispatchProfiles(sender).pipe(Effect.provideService(ArtifactRepository, repository));
    const fetch = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = new URL(request.url, "http://test").pathname;
      if (path === "/ready") return HttpServerResponse.text("ready");
      if (path === "/dispatch") {
        yield* dispatch(queue);
        return HttpServerResponse.empty({ status: 204 });
      }
      const [mode, rawId] = path.slice(1).split("/");
      const id = yield* Schema.decodeUnknownEffect(ArtifactId)(rawId);
      if (request.method === "POST") {
        yield* repository.insert({
          id,
          fileName: "source.csv",
          objectKey: `source/${id}`,
          contentType: "text/csv",
          byteSize: 9,
          createdAt: "2026-08-22T00:00:00Z",
        });
        yield* dispatch({
          send: (body) =>
            (mode === "ambiguous" ? queue.send(body) : Effect.void).pipe(
              Effect.andThen(Effect.fail(new SendError({ message: "Queue reply unavailable" }))),
            ),
        });
      }
      const pending = yield* repository.pendingDelivery;
      const delivery = yield* db
        .prepare("SELECT artifact_id FROM deliveries WHERE artifact_id = ?")
        .bind(id)
        .first();
      return HttpServerResponse.jsonUnsafe({
        pending: pending.some((row) => row.id === id),
        delivered: delivery !== null,
      });
    }).pipe(
      Effect.catchTags({
        SchemaError: () => Effect.succeed(HttpServerResponse.empty({ status: 400 })),
        StorageFailure: () => Effect.succeed(HttpServerResponse.empty({ status: 500 })),
      }),
    );
    return { fetch };
  }).pipe(
    Effect.provide([
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.R2.ReadWriteBucketBinding,
      Cloudflare.Queues.WriteQueueBinding,
      Cloudflare.Queues.EventSourceLive,
    ]),
  ),
);
