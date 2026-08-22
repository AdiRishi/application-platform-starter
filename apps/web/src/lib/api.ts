import {
  ApiError,
  ArtifactDetail,
  ArtifactSummary,
  ListArtifactsResponse,
  type ArtifactDetail as Detail,
  type ArtifactSummary as Summary,
} from "@repo/contracts";
import { Schema } from "effect";

const decodeError = Schema.decodeUnknownPromise(ApiError);

const decodeResponse = async <A, I>(schema: Schema.Codec<A, I, never>, response: Response) => {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = await decodeError(body);
    throw new Error(error.message);
  }
  return Schema.decodeUnknownPromise(schema)(body);
};

export const listArtifacts = async (): Promise<ReadonlyArray<Summary>> =>
  decodeResponse(ListArtifactsResponse, await fetch("/api/artifacts"));

export const getArtifact = async (artifactId: string): Promise<Detail> =>
  decodeResponse(ArtifactDetail, await fetch(`/api/artifacts/${artifactId}`));

export const uploadArtifact = async (file: File): Promise<Summary> => {
  const form = new FormData();
  form.set("file", file);
  return decodeResponse(
    ArtifactSummary,
    await fetch("/api/artifacts", { body: form, method: "POST" }),
  );
};

export const artifactDownloadUrl = (artifactId: string) => `/api/artifacts/${artifactId}/source`;
