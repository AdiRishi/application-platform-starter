import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

import { ArtifactNotFound, ArtifactsUnavailable } from "./errors";
import { ArtifactDetail, ArtifactId, ListArtifactsResponse } from "./schema";

export const listArtifactsRpc = Rpc.make("listArtifacts", {
  error: ArtifactsUnavailable,
  success: ListArtifactsResponse,
});

export const getArtifactRpc = Rpc.make("getArtifact", {
  error: Schema.Union([ArtifactNotFound, ArtifactsUnavailable]),
  payload: { artifactId: ArtifactId },
  success: ArtifactDetail,
});
