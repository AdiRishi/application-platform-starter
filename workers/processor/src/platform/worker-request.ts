import { makeWorkerRequestContext } from "@repo/contracts/server";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";

export const processorRequest = makeWorkerRequestContext<ProcessorEnv, ExecutionContext>(
  "Processor/WorkerRequest",
);
