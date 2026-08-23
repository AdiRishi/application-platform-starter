import type * as Workers from "@cloudflare/workers-types";
import type { ArtifactId } from "@repo/contracts";
import * as Cloudflare from "alchemy/Cloudflare";

import type { DataPlane } from "./data-plane.ts";

export interface ProfileSessionBinding extends Workers.Rpc.DurableObjectBranded {
  complete(artifactId: ArtifactId): Promise<void>;
  fail(artifactId: ArtifactId, message: string): Promise<void>;
  getState(artifactId: ArtifactId): Promise<string>;
  initialize(artifactId: ArtifactId): Promise<void>;
  progress(artifactId: ArtifactId, rowsProcessed: number, totalRows: number): Promise<void>;
}

export const processorBindings = (data: DataPlane, environment: string) => ({
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
  environment: string,
  processor: Cloudflare.Worker,
) => ({
  ARTIFACTS: data.artifacts,
  DB: data.database,
  ENVIRONMENT: environment,
  PROFILE_JOBS: data.profileJobs,
  PROCESSOR: Cloudflare.WorkerEntrypoint(processor),
});

export const websiteBindings = (environment: string, api: Cloudflare.Worker) => ({
  API: Cloudflare.WorkerEntrypoint(api),
  ENVIRONMENT: environment,
});

export type ProcessorEnv = Cloudflare.InferEnv<ReturnType<typeof processorBindings>>;
export type ApiEnv = Cloudflare.InferEnv<ReturnType<typeof apiBindings>>;
export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof websiteBindings>>;
