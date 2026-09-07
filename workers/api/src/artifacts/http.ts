import {
  ApiError,
  ArtifactId,
  ArtifactNotFound,
  type ArtifactSummary,
  maxUploadBytes,
  CsvUpload,
} from "@repo/contracts/schema";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect, Schema } from "effect";

import { apiRequest } from "../platform/worker-request.ts";
import { dispatchProfiles } from "./dispatch.ts";
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
  const form = yield* Effect.tryPromise({
    try: async () => {
      const maxRequestBytes = maxUploadBytes + 16 * 1024;
      if (Number(request.headers.get("content-length")) > maxRequestBytes)
        throw new Error("Upload too large.");
      const reader = request.body?.getReader();
      if (reader === undefined) throw new Error("Missing upload.");
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxRequestBytes) {
            await reader.cancel();
            throw new Error("Upload too large.");
          }
          chunks.push(new Uint8Array(chunk.value));
        }
      } finally {
        reader.releaseLock();
      }
      return new Response(new Blob(chunks), { headers: request.headers }).formData();
    },
    catch: () => new InvalidRequest({ message: "Choose a CSV file of 256 KB or smaller." }),
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
    executionContext.waitUntil(dispatchProfiles(env.DB, env.PROFILE_JOBS));
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
