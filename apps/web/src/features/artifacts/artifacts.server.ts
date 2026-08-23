import "@tanstack/react-start/server-only";
import { type ApiClient, ApiRpcs, clientOverBinding } from "@repo/contracts/client";
import {
  ApiError,
  ArtifactSummary,
  type ArtifactId,
  type ArtifactDetail,
} from "@repo/contracts/schema";
import { env } from "cloudflare:workers";
import { Duration, Effect, Schema } from "effect";

const apiOrigin = "https://api.internal";
const decodeApiError = Schema.decodeUnknownPromise(ApiError);

const requestApi = (path: string, init?: RequestInit) =>
  env.API.fetch(new Request(new URL(path, apiOrigin), init));

const callApi = <A, E>(use: (client: ApiClient) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(ApiRpcs, {
        binding: env.API,
        service: "api",
        timeout: Duration.seconds(10),
      });
      return yield* use(client);
    }).pipe(Effect.scoped),
  );

const decodeResponse = async <A, I>(schema: Schema.Codec<A, I, never>, response: Response) => {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = await decodeApiError(body);
    throw new Error(error.message);
  }
  return Schema.decodeUnknownPromise(schema)(body);
};

export const listArtifactsFromApi = (): Promise<ReadonlyArray<ArtifactSummary>> =>
  callApi((client) => client.listArtifacts());

export const getArtifactFromApi = (artifactId: ArtifactId): Promise<ArtifactDetail> =>
  callApi((client) => client.getArtifact({ artifactId }));

export const uploadArtifactToApi = async (file: File): Promise<ArtifactSummary> => {
  const form = new FormData();
  form.set("file", file);
  return decodeResponse(
    ArtifactSummary,
    await requestApi("/api/artifacts", { body: form, method: "POST" }),
  );
};

export const getArtifactSourceFromApi = (artifactId: ArtifactId): Promise<Response> =>
  requestApi(`/api/artifacts/${encodeURIComponent(artifactId)}/source`);
