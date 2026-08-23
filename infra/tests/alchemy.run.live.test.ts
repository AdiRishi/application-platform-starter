import { ArtifactDetail, ArtifactSummary } from "@repo/contracts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { expect } from "vitest";

import Stack from "../alchemy.run.ts";
import { Stage } from "../src/deployment-config.ts";

const stage = Stage.make(process.env.ALCHEMY_TEST_STAGE ?? "test");
const {
  afterAll,
  beforeAll,
  deploy,
  destroy,
  test: liveTest,
} = Test.make({
  providers: Cloudflare.providers(),
  stage,
  state: Cloudflare.state(),
});

const stack = beforeAll(deploy(Stack), { timeout: 600_000 });

afterAll.skipIf(process.env.NO_DESTROY === "1")(destroy(Stack), { timeout: 600_000 });

liveTest(
  "processes a CSV through the deployed application",
  Effect.gen(function* () {
    const output = yield* stack;
    if (output.websiteUrl === undefined) {
      return yield* Effect.die(new Error("The deployed stack did not return a website URL."));
    }
    const websiteUrl = output.websiteUrl;
    const ready = yield* Test.getWhenReady(websiteUrl, { times: 30 });
    expect(ready.status).toBe(200);

    const source = [
      "date,description,amount",
      "2026-08-01,Coffee,-4.80",
      "2026-08-02,Salary,2500",
      "",
    ].join("\n");
    const artifactsUrl = new URL("/api/artifacts", websiteUrl).toString();
    const body = HttpBody.formDataRecord({
      file: new File([source], "transactions.csv", { type: "text/csv" }),
    });
    const upload = yield* Test.executeWhenReady(HttpClientRequest.post(artifactsUrl, { body }), {
      times: 30,
    });

    expect(upload.status).toBe(202);
    const artifact = yield* upload.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ArtifactSummary)),
    );
    expect(artifact).toMatchObject({
      byteSize: 71,
      contentType: "text/csv",
      fileName: "transactions.csv",
      status: "queued",
    });

    const detailUrl = new URL(`/api/artifacts/${artifact.id}`, websiteUrl).toString();
    const readDetail = HttpClient.get(detailUrl).pipe(
      Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))),
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(ArtifactDetail)),
    );
    const completed = yield* readDetail.pipe(
      Effect.repeat({
        schedule: Schedule.spaced("1 second"),
        times: 60,
        until: (detail) => detail.status === "complete" || detail.status === "failed",
      }),
    );

    expect(completed).toMatchObject({
      profile: {
        columns: [
          { kind: "date", maximum: "2026-08-02", minimum: "2026-08-01", name: "date" },
          { kind: "string", name: "description" },
          { kind: "number", maximum: 2500, minimum: -4.8, name: "amount" },
        ],
        malformedRows: 0,
        rowCount: 2,
      },
      status: "complete",
    });

    const download = yield* HttpClient.get(
      new URL(`/api/artifacts/${artifact.id}/source`, websiteUrl).toString(),
    );
    expect(download.status).toBe(200);
    expect(yield* download.text).toBe(source);
  }),
  { timeout: 180_000 },
);
