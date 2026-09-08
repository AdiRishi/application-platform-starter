import { ArtifactSummary } from "@repo/contracts/artifacts";
import { ApiRpcs } from "@repo/contracts/artifacts/api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Schedule, Schema, Stream } from "effect";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { expect } from "vitest";

import Stack from "../alchemy.run.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: true,
});
const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.flatMap((output) =>
      Effect.gen(function* () {
        const apiUrl = yield* Schema.decodeUnknownEffect(Schema.String)(output.apiUrl);
        const websiteUrl = yield* Schema.decodeUnknownEffect(Schema.String)(output.websiteUrl);
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy declares its readiness helper error channel as unknown.
        yield* Test.getWhenReady(websiteUrl);
        return { apiUrl };
      }),
    ),
  ),
);
afterAll(destroy(Stack));
const source = "date,description,amount\n2026-08-01,Coffee,-4.80\n2026-08-02,Salary,4250.00\n";

const upload = Effect.fn(function* (contents = source, name = "transactions.csv") {
  const { apiUrl } = yield* stack;
  const form = new FormData();
  form.set("file", new File([contents], name, { type: "text/csv" }));
  const response = yield* HttpClient.post(`${apiUrl}/api/artifacts`, {
    body: HttpBody.formData(form),
  });
  expect(response.status).toBe(202);
  return yield* Schema.decodeUnknownEffect(ArtifactSummary)(yield* response.json);
});

const detail = Effect.fn(function* (artifactId: ArtifactSummary["id"]) {
  const { apiUrl } = yield* stack;
  return yield* Effect.gen(function* () {
    const client = yield* RpcClient.make(ApiRpcs);
    return yield* client.getArtifact({ artifactId });
  }).pipe(
    Effect.scoped,
    Effect.provide(Test.rpcClientLayer(`${apiUrl}/rpc`, { serialization: RpcSerialization.json })),
  );
});
const finished = (artifactId: ArtifactSummary["id"]) =>
  detail(artifactId).pipe(
    Effect.retry({
      while: (error) => error._tag === "ArtifactsUnavailable",
      schedule: Schedule.spaced("100 millis"),
      times: 5,
    }),
    Effect.repeat({
      schedule: Schedule.spaced("100 millis"),
      until: (artifact) => artifact.status === "complete" || artifact.status === "failed",
      times: 100,
    }),
  );

test(
  "an uploaded CSV is profiled through the queue and remains downloadable",
  Effect.gen(function* () {
    const artifact = yield* upload();
    expect(artifact).toMatchObject({
      fileName: "transactions.csv",
      status: "queued",
      contentType: "text/csv",
      byteSize: 74,
    });
    const completed = yield* finished(artifact.id);
    expect(completed).toMatchObject({
      status: "complete",
      profile: {
        rowCount: 2,
        malformedRows: 0,
        columns: [
          { name: "date", kind: "date", minimum: "2026-08-01", maximum: "2026-08-02" },
          { name: "description", kind: "string" },
          { name: "amount", kind: "number", minimum: -4.8, maximum: 4250 },
        ],
      },
    });
    const { apiUrl } = yield* stack;
    const response = yield* HttpClient.get(`${apiUrl}/api/artifacts/${artifact.id}/source`);
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="transactions.csv"');
    expect(yield* response.text).toBe(source);
    const listed = yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(ApiRpcs);
      return yield* client.listArtifacts();
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Test.rpcClientLayer(`${apiUrl}/rpc`, { serialization: RpcSerialization.json }),
      ),
    );
    expect(listed).toContainEqual(
      expect.objectContaining({ id: artifact.id, status: "complete", rowCount: 2 }),
    );
  }),
  { timeout: 20_000 },
);

test(
  "quoted file names survive storage and RPC reads",
  Effect.gen(function* () {
    const artifact = yield* upload("name\nAdi\n", "Adi's 'transactions'.csv");
    expect(yield* finished(artifact.id)).toMatchObject({
      id: artifact.id,
      fileName: "Adi's 'transactions'.csv",
      status: "complete",
    });
  }),
);

test(
  "malformed CSV becomes a terminal failure and the source remains downloadable",
  Effect.gen(function* () {
    const source = 'name\n"unterminated';
    const artifact = yield* upload(source);
    expect(yield* finished(artifact.id)).toMatchObject({
      status: "failed",
      error: "The CSV could not be profiled.",
    });
    const { apiUrl } = yield* stack;
    const response = yield* HttpClient.get(`${apiUrl}/api/artifacts/${artifact.id}/source`);
    expect(yield* response.text).toBe(source);
  }),
);

for (const file of [
  new File(["not csv"], "notes.txt", { type: "text/plain" }),
  new File([], "empty.csv", { type: "text/csv" }),
  new File(["x".repeat(256 * 1024 + 1)], "large.csv", { type: "text/csv" }),
]) {
  test(
    `uploads reject ${file.name}`,
    Effect.gen(function* () {
      const { apiUrl } = yield* stack;
      const form = new FormData();
      form.set("file", file);
      const response = yield* HttpClient.post(`${apiUrl}/api/artifacts`, {
        body: HttpBody.formData(form),
      });
      expect(response.status).toBe(400);
      expect(yield* response.json).toMatchObject({
        code: "invalid_request",
      });
    }),
  );
}

for (const route of [
  { path: "/api/artifacts/not-a-uuid/source", status: 400, code: "invalid_request" },
  {
    path: "/api/artifacts/28f31da1-a2ed-4f1f-a9d9-463107ad09f0/source",
    status: 404,
    code: "not_found",
  },
  { path: "/missing", status: 404, code: "not_found" },
]) {
  test(
    `HTTP routing preserves the error contract for ${route.path}`,
    Effect.gen(function* () {
      const { apiUrl } = yield* stack;
      const response = yield* HttpClient.get(`${apiUrl}${route.path}`);
      expect(response.status).toBe(route.status);
      expect(yield* response.json).toMatchObject({ code: route.code });
    }),
  );
}

test(
  "the health route reports the test environment",
  Effect.gen(function* () {
    const { apiUrl } = yield* stack;
    const response = yield* HttpClient.get(`${apiUrl}/health`);
    expect(yield* response.json).toEqual({ environment: "test", service: "api" });
  }),
);

test(
  "an upload without Content-Length is bounded before multipart parsing",
  Effect.gen(function* () {
    const { apiUrl } = yield* stack;
    const response = yield* HttpClient.post(`${apiUrl}/api/artifacts`, {
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: HttpBody.stream(Stream.make(new Uint8Array(300 * 1024))),
    });
    expect(response.status).toBe(400);
    expect(yield* response.json).toMatchObject({ code: "invalid_request" });
  }),
);
