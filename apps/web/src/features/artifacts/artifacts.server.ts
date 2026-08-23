import "@tanstack/react-start/server-only";
import {
  ApiError,
  ArtifactDetail,
  ArtifactSummary,
  ListArtifactsResponse,
  type ArtifactId,
  type ArtifactDetail as Detail,
  type ArtifactSummary as Summary,
} from "@repo/contracts";
import { env } from "cloudflare:workers";
import { Schema } from "effect";

const apiOrigin = "https://api.internal";
const decodeApiError = Schema.decodeUnknownPromise(ApiError);

const requestApi = (path: string, init?: RequestInit) =>
  env.API.fetch(new Request(new URL(path, apiOrigin), init));

const decodeResponse = async <A, I>(schema: Schema.Codec<A, I, never>, response: Response) => {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = await decodeApiError(body);
    throw new Error(error.message);
  }
  return Schema.decodeUnknownPromise(schema)(body);
};

export const listArtifactsFromApi = async (): Promise<ReadonlyArray<Summary>> =>
  decodeResponse(ListArtifactsResponse, await requestApi("/api/artifacts"));

export const getArtifactFromApi = async (artifactId: ArtifactId): Promise<Detail> =>
  decodeResponse(
    ArtifactDetail,
    await requestApi(`/api/artifacts/${encodeURIComponent(artifactId)}`),
  );

export const uploadArtifactToApi = async (file: File): Promise<Summary> => {
  const form = new FormData();
  form.set("file", file);
  return decodeResponse(
    ArtifactSummary,
    await requestApi("/api/artifacts", { body: form, method: "POST" }),
  );
};

export const getArtifactSourceFromApi = (artifactId: ArtifactId): Promise<Response> =>
  requestApi(`/api/artifacts/${encodeURIComponent(artifactId)}/source`);
