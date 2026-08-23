import { readFile } from "node:fs/promises";

import { ApiRpcs } from "@repo/contracts/client";
import { ArtifactSummary } from "@repo/contracts/schema";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import { expect } from "vitest";

import Stack from "../alchemy.run.ts";
import {
  afterAll,
  beforeAll,
  deploy,
  destroy,
  executeWhenReady,
  getWhenReady,
  rpcClientLayer,
  test,
} from "./support/live-harness.ts";

const stack = beforeAll(deploy(Stack), { timeout: 600_000 });

afterAll(destroy(Stack), { timeout: 600_000 });

test(
  "processes a CSV through the deployed application",
  Effect.gen(function* () {
    const output = yield* stack;
    if (output.websiteUrl === undefined) {
      return yield* Effect.die(new Error("The deployed stack did not return a website URL."));
    }
    if (output.liveTestApiUrl === undefined) {
      return yield* Effect.die(new Error("The deployed stack did not return a live-test API URL."));
    }
    const apiUrl = output.liveTestApiUrl;
    const websiteUrl = output.websiteUrl;
    const ready = yield* getWhenReady(websiteUrl, { times: 30 });
    expect(ready.status).toBe(200);

    const source = yield* Effect.tryPromise(() =>
      readFile(new URL("../../fixtures/transactions.csv", import.meta.url), "utf8"),
    );
    const artifactsUrl = new URL("/api/artifacts", apiUrl).toString();
    const body = HttpBody.formDataRecord({
      file: new File([source], "transactions.csv", { type: "text/csv" }),
    });
    const upload = yield* executeWhenReady(HttpClientRequest.post(artifactsUrl, { body }), {
      times: 30,
    });

    expect(upload.status).toBe(202);
    const artifact = yield* upload.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ArtifactSummary)),
    );
    expect(artifact).toMatchObject({
      byteSize: 199,
      contentType: "text/csv",
      fileName: "transactions.csv",
      status: "queued",
    });

    const client = yield* RpcClient.make(ApiRpcs).pipe(
      Effect.provide(
        rpcClientLayer(new URL("/rpc", apiUrl).toString(), {
          serialization: RpcSerialization.json,
        }),
      ),
    );
    const completed = yield* client.getArtifact({ artifactId: artifact.id }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("1 second"),
        times: 60,
        until: (detail) => detail.status === "complete" || detail.status === "failed",
      }),
    );

    expect(completed).toMatchObject({
      profile: {
        columns: [
          { kind: "date", maximum: "2026-08-05", minimum: "2026-08-01", name: "date" },
          { kind: "string", name: "description" },
          { kind: "number", maximum: 4250, minimum: -87.32, name: "amount" },
          { kind: "string", name: "currency" },
        ],
        malformedRows: 0,
        rowCount: 5,
      },
      status: "complete",
    });

    const download = yield* HttpClient.get(
      new URL(`/artifacts/${artifact.id}/source`, websiteUrl).toString(),
    );
    expect(download.status).toBe(200);
    expect(yield* download.text).toBe(source);
  }),
  { timeout: 180_000 },
);
