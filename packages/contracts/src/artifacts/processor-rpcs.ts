import { Rpc } from "effect/unstable/rpc";

import { ProcessingStateUnavailable } from "./errors.ts";
import { ArtifactId, ProcessingState } from "./schema.ts";

export const getProcessingStateRpc = Rpc.make("getProcessingState", {
  error: ProcessingStateUnavailable,
  payload: { artifactId: ArtifactId },
  success: ProcessingState,
});
