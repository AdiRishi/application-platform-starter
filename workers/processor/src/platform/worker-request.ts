import { makeWorkerRequestContext, type WorkerRequest } from "@repo/contracts/server";
import type { ProcessorEnv } from "@repo/infra/worker-bindings";

export type ProcessorRequest = WorkerRequest<ProcessorEnv, ExecutionContext>;

export const processorRequest = makeWorkerRequestContext<ProcessorEnv, ExecutionContext>(
  "Processor/WorkerRequest",
);
