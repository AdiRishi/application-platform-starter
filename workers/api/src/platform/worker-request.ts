import { makeWorkerRequestContext } from "@repo/contracts/server";
import type { ApiEnv } from "@repo/infra/worker-bindings";

export const apiRequest = makeWorkerRequestContext<ApiEnv, ExecutionContext>("Api/WorkerRequest");
