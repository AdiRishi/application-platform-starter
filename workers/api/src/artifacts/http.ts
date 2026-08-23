import {
  ApiError,
  ArtifactId,
  type ArtifactSummary,
  maxUploadBytes,
  type ProfileJob,
} from "@repo/contracts";
import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Effect, Schema } from "effect";

import { type ApiFailure, ArtifactNotFound, InvalidRequest, StorageFailure } from "./errors.ts";
import { ProcessorClient } from "./processing-client.ts";
import {
  getArtifactDetail,
  getSource,
  insertArtifact,
  listArtifacts,
  markQueueFailure,
  sendProfileJob,
} from "./repository.ts";

const decodeArtifactId = Schema.decodeUnknownEffect(ArtifactId);
const decodeArtifactIdSync = Schema.decodeUnknownSync(ArtifactId);

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

const createArtifact = Effect.fn("Api.createArtifact")(function* (request: Request, env: ApiEnv) {
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

  const id = decodeArtifactIdSync(crypto.randomUUID());
  const createdAt = new Date().toISOString();
  const objectKey = `artifacts/${id}/source.csv`;
  const contentType = entry.type.length > 0 ? entry.type : "text/csv";

  yield* Effect.tryPromise({
    try: () =>
      env.ARTIFACTS.put(objectKey, entry.stream(), {
        customMetadata: { artifactId: id, fileName: entry.name },
        httpMetadata: { contentType },
      }),
    catch: (cause) => new StorageFailure({ cause, operation: "store artifact source" }),
  });
  yield* insertArtifact(env, {
    byteSize: entry.size,
    contentType,
    createdAt,
    fileName: entry.name,
    id,
    objectKey,
  });

  const job = { artifactId: id } satisfies ProfileJob;
  yield* sendProfileJob(env, job).pipe(
    Effect.catch((failure) => markQueueFailure(env, id).pipe(Effect.andThen(Effect.fail(failure)))),
  );

  return {
    byteSize: entry.size,
    contentType,
    createdAt,
    fileName: entry.name,
    id,
    status: "queued",
  } satisfies ArtifactSummary;
});

const route = Effect.fn("Api.route")(function* (request: Request, env: ApiEnv) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ environment: env.ENVIRONMENT, service: "api" });
  }
  if (request.method === "GET" && url.pathname === "/api/artifacts") {
    return Response.json(yield* listArtifacts(env));
  }
  if (request.method === "POST" && url.pathname === "/api/artifacts") {
    return Response.json(yield* createArtifact(request, env), { status: 202 });
  }

  const sourceMatch = /^\/api\/artifacts\/([^/]+)\/source$/.exec(url.pathname);
  if (request.method === "GET" && sourceMatch?.[1] !== undefined) {
    const artifactId = yield* parseArtifactId(sourceMatch[1]);
    const { object, row } = yield* getSource(env, artifactId);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", `attachment; filename=${JSON.stringify(row.file_name)}`);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  }

  const detailMatch = /^\/api\/artifacts\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && detailMatch?.[1] !== undefined) {
    const artifactId = yield* parseArtifactId(detailMatch[1]);
    return Response.json(yield* getArtifactDetail(env, artifactId));
  }

  return Response.json({ code: "not_found", message: "Route not found." } satisfies ApiError, {
    status: 404,
  });
});

export const handleRequest = (request: Request, env: ApiEnv): Promise<Response> =>
  Effect.runPromise(
    route(request, env).pipe(
      Effect.provide(ProcessorClient.layer(env.PROCESSOR)),
      Effect.scoped,
      Effect.catch((failure) => {
        if (failure instanceof StorageFailure) {
          return Effect.logError("API storage operation failed").pipe(
            Effect.annotateLogs({ operation: failure.operation }),
            Effect.as(errorResponse(failure)),
          );
        }
        return Effect.succeed(errorResponse(failure));
      }),
    ),
  );
