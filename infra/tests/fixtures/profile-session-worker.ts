import { ArtifactId } from "@repo/contracts/artifacts";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { workerCompatibility } from "../../src/cloudflare-config.ts";
import { CsvProfileSession } from "../../src/profile-session.ts";

const Progress = Schema.Struct({ rowsProcessed: Schema.Int, totalRows: Schema.Int });

export default Cloudflare.Worker(
  "ProfileSessionTestWorker",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
  },
  Effect.gen(function* () {
    const sessions = yield* CsvProfileSession;
    const fetch = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = yield* Schema.decodeEffect(ArtifactId)(
        new URL(request.url, "http://test").pathname.slice(1),
      );
      const session = sessions.getByName(id);
      if (request.method === "POST") {
        const progress = yield* Schema.decodeUnknownEffect(Progress)(yield* request.json);
        yield* session.progress(progress.rowsProcessed, progress.totalRows);
      }
      return HttpServerResponse.jsonUnsafe(yield* session.getState());
    }).pipe(
      Effect.catchTag("SchemaError", () =>
        Effect.succeed(HttpServerResponse.empty({ status: 400 })),
      ),
    );
    return { fetch };
  }),
);
