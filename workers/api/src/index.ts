import type { ApiEnv } from "@repo/infra/worker-bindings";

import { handleProfileDispatch } from "./artifacts/dispatch.ts";
import { handleHttpRequest } from "./artifacts/http.ts";
import { handleRpcRequest } from "./artifacts/rpc.ts";

export default {
  scheduled: (_controller, env, context) => handleProfileDispatch(env, context),
  fetch(request: Request, env: ApiEnv, executionContext: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    return path === "/rpc" || path === "/rpc/"
      ? handleRpcRequest(request, env, executionContext)
      : handleHttpRequest(request, env, executionContext);
  },
} satisfies ExportedHandler<ApiEnv>;
