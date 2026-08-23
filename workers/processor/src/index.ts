import type { ProcessorEnv } from "@repo/infra/worker-bindings";

import { handleQueue } from "./artifacts/profile-job.ts";
import { handleRpcRequest } from "./artifacts/rpc.ts";
export { CsvProfileSession } from "./artifacts/profile-session.ts";

export default {
  fetch: handleRpcRequest,
  queue: handleQueue,
} satisfies ExportedHandler<ProcessorEnv>;
