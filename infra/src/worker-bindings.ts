import type * as Workers from "@cloudflare/workers-types";
import type { ProcessingState } from "@repo/contracts/artifacts";
import * as Cloudflare from "alchemy/Cloudflare";

import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";

export interface ProfileSessionBinding extends Workers.Rpc.DurableObjectBranded {
  getState(): Promise<{ readonly state: ProcessingState }>;
  progress(rowsProcessed: number, totalRows: number): Promise<void>;
}

export const processorBindings = (
  data: DataPlane,
  environment: DeploymentConfig["environment"],
) => ({
  ARTIFACTS: data.artifacts,
  DB: data.database,
  DEAD_LETTER_QUEUE_NAME: data.deadLetters.queueName,
  ENVIRONMENT: environment,
  PROFILE_SESSIONS: Cloudflare.DurableObject<ProfileSessionBinding>("ProfileSessions", {
    className: "CsvProfileSession",
  }),
});

export const apiBindings = (
  data: DataPlane,
  environment: DeploymentConfig["environment"],
  processor: Cloudflare.Worker,
) => ({
  ARTIFACTS: data.artifacts,
  DB: data.database,
  ENVIRONMENT: environment,
  PROFILE_JOBS: data.profileJobs,
  PROCESSOR: Cloudflare.WorkerEntrypoint(processor),
});

export const websiteBindings = (
  environment: DeploymentConfig["environment"],
  api: Cloudflare.Worker,
) => ({
  API: Cloudflare.WorkerEntrypoint(api),
  ENVIRONMENT: environment,
});

export type ProcessorEnv = Cloudflare.InferEnv<ReturnType<typeof processorBindings>>;
export type ApiEnv = Cloudflare.InferEnv<ReturnType<typeof apiBindings>>;
export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof websiteBindings>>;
