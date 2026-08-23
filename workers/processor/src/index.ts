import type { ProcessorEnv } from "@repo/infra/worker-bindings";

import { handleQueue } from "./artifacts/profile-job.ts";
import { processorRpcHandler } from "./artifacts/rpc.ts";
export { CsvProfileSession } from "./artifacts/profile-session.ts";

let rpcHandler: ReturnType<typeof processorRpcHandler> | undefined;

export default {
  fetch(request: Request, env: ProcessorEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/rpc" && url.pathname !== "/rpc/")) {
      return Promise.resolve(Response.json({ message: "Not found." }, { status: 404 }));
    }
    rpcHandler ??= processorRpcHandler(env);
    return rpcHandler(request);
  },
  queue: handleQueue,
} satisfies ExportedHandler<ProcessorEnv>;
