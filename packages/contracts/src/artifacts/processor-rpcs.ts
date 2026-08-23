import { Rpc } from "effect/unstable/rpc";

import { ProcessingStateUnavailable } from "./errors";
import { ArtifactId, ProcessingState } from "./schema";

export const getProcessingStateRpc = Rpc.make("getProcessingState", {
  error: ProcessingStateUnavailable,
  payload: { artifactId: ArtifactId },
  success: ProcessingState,
});
