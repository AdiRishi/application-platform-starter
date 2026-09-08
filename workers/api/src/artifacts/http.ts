import {
  ApiError,
  ArtifactId,
  ArtifactNotFound,
  type ArtifactSummary,
  maxUploadBytes,
  CsvUpload,
} from "@repo/contracts/artifacts";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect, Schema, Stream } from "effect";

import { apiRequest } from "../platform/worker-request.ts";
import { handleProfileDispatch } from "./dispatch.ts";
import { type ApiFailure, InvalidRequest, StorageFailure } from "./errors.ts";
import { Artifacts } from "./service.ts";

const decodeArtifactId = Schema.decodeUnknownEffect(ArtifactId);

const errorResponse = (failure: ApiFailure): Response => {
  if (Schema.is(InvalidRequest)(failure)) {
    return Response.json({ code: "invalid_request", message: failure.message } satisfies ApiError, {
      status: 400,
    });
  }
  if (Schema.is(ArtifactNotFound)(failure)) {
    return Response.json({ code: "not_found", message: "Artifact not found." } satisfies ApiError, {
      status: 404,
    });
  }
  return Response.json(
    {
      code: "storage_failure",
      message: "The platform could not complete the request.",
    } satisfies ApiError,
    { status: 500 },
  );
};

const parseArtifactId = (value: string) =>
  decodeArtifactId(value).pipe(
    Effect.mapError(() => new InvalidRequest({ message: "The artifact id is invalid." })),
  );

const readUpload = Effect.fn("Api.readUpload")(function* (request: Request) {
  const invalidUpload = () =>
    new InvalidRequest({ message: "Choose a CSV file of 256 KB or smaller." });
  const maxRequestBytes = maxUploadBytes + 16 * 1024;
  const body = request.body;
  if (Number(request.headers.get("content-length")) > maxRequestBytes || body === null) {
    return yield* invalidUpload();
  }
  let size = 0;
  const chunks = yield* Stream.fromReadableStream({
    evaluate: () => body,
    onError: invalidUpload,
  }).pipe(
    Stream.mapEffect((chunk) => {
      size += chunk.byteLength;
      return size > maxRequestBytes
        ? Effect.fail(invalidUpload())
        : Effect.succeed(new Uint8Array(chunk));
    }),
    Stream.runCollect,
  );
  const form = yield* Effect.tryPromise({
    try: () => new Response(new Blob(chunks), { headers: request.headers }).formData(),
    catch: invalidUpload,
  });
  const entry = yield* Schema.decodeUnknownEffect(CsvUpload)(form.get("file")).pipe(
    Effect.mapError(
      () => new InvalidRequest({ message: "Choose a non-empty .csv file of 256 KB or smaller." }),
    ),
  );
  return entry;
});

const route = Effect.fn("Api.route")(function* (request: Request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    const { env } = yield* apiRequest.service;
    return Response.json({ environment: env.ENVIRONMENT, service: "api" });
  }
  if (request.method === "POST" && url.pathname === "/api/artifacts") {
    const file = yield* readUpload(request);
    const artifact = yield* Artifacts.use((artifacts) => artifacts.create(file));
    const { env, executionContext } = yield* apiRequest.service;
    executionContext.waitUntil(handleProfileDispatch(env, executionContext));
    return Response.json(artifact satisfies ArtifactSummary, { status: 202 });
  }

  const sourceMatch = /^\/api\/artifacts\/([^/]+)\/source$/.exec(url.pathname);
  if (request.method === "GET" && sourceMatch?.[1] !== undefined) {
    const artifactId = yield* parseArtifactId(sourceMatch[1]);
    const { object, row } = yield* Artifacts.use((artifacts) => artifacts.readSource(artifactId));
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", `attachment; filename=${JSON.stringify(row.file_name)}`);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  }

  return Response.json({ code: "not_found", message: "Route not found." } satisfies ApiError, {
    status: 404,
  });
});

export const handleHttpRequest = (
  request: Request,
  env: ApiEnv,
  executionContext: ExecutionContext,
): Promise<Response> =>
  Effect.runPromise(
    route(request).pipe(
      Effect.provide(Artifacts.live),
      Effect.provideService(apiRequest.service, { env, executionContext }),
      Effect.catch((failure) => {
        if (Schema.is(StorageFailure)(failure)) {
          return Effect.logError("API storage operation failed", failure.cause).pipe(
            Effect.annotateLogs({ operation: failure.operation }),
            Effect.as(errorResponse(failure)),
          );
        }
        return Effect.succeed(errorResponse(failure));
      }),
    ),
    { signal: request.signal },
  );
