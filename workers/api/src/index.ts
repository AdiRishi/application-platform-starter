import type { ApiEnv } from "@repo/infra/worker-bindings";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { handleProfileDispatch } from "./artifacts/dispatch.ts";
import { artifactHttpRoutes } from "./artifacts/http.ts";
import { artifactRpcRoutes } from "./artifacts/rpc.ts";
import { apiRequest } from "./platform/worker-request.ts";

const http = HttpRouter.toWebHandler(Layer.mergeAll(artifactHttpRoutes, artifactRpcRoutes));

export default {
  scheduled: (_controller, env, context) => handleProfileDispatch(env, context),
  fetch(request: Request, env: ApiEnv, executionContext: ExecutionContext): Promise<Response> {
    return http.handler(request, apiRequest.forRequest(env, executionContext));
  },
} satisfies ExportedHandler<ApiEnv>;
