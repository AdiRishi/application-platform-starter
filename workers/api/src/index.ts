import type { ApiEnv } from "@repo/infra/worker-bindings";

import { handleRequest } from "./artifacts/http.ts";

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<ApiEnv>;
