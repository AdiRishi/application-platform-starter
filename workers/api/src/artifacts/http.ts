import {
  ApiError,
  ArtifactId,
  ArtifactNotFound,
  type ArtifactSummary,
  maxUploadBytes,
} from "@repo/contracts/schema";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect, Schema } from "effect";

import { apiRequest } from "../platform/worker-request.ts";
import { type ApiFailure, InvalidRequest, StorageFailure } from "./errors.ts";
import { Artifacts } from "./service.ts";

const decodeArtifactId = Schema.decodeUnknownEffect(ArtifactId);

const errorResponse = (failure: ApiFailure): Response => {
  if (failure instanceof InvalidRequest) {
    return Response.json({ code: "invalid_request", message: failure.message } satisfies ApiError, {
      status: 400,
    });
  }
  if (failure instanceof ArtifactNotFound) {
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
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > maxUploadBytes + 128 * 1024) {
    return yield* new InvalidRequest({ message: "CSV files must be 10 MB or smaller." });
  }

  const form = yield* Effect.tryPromise({
    try: () => request.formData(),
    catch: () => new InvalidRequest({ message: "The upload form could not be read." }),
  });
  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return yield* new InvalidRequest({ message: "Choose a CSV file to upload." });
  }
  if (entry.size === 0 || entry.size > maxUploadBytes) {
    return yield* new InvalidRequest({ message: "CSV files must be between 1 byte and 10 MB." });
  }
  if (!entry.name.toLowerCase().endsWith(".csv")) {
    return yield* new InvalidRequest({ message: "Only .csv files are accepted." });
  }
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
        if (failure instanceof StorageFailure) {
          return Effect.logError("API storage operation failed", failure.cause).pipe(
            Effect.annotateLogs({ operation: failure.operation }),
            Effect.as(errorResponse(failure)),
          );
        }
        return Effect.succeed(errorResponse(failure));
      }),
    ),
  );
