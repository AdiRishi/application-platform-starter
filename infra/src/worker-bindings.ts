import type * as Workers from "@cloudflare/workers-types";
import type { ArtifactId } from "@repo/contracts";
import * as Cloudflare from "alchemy/Cloudflare";
import type { Input } from "alchemy/Input";

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

export const apiBindings = (data: DataPlane, environment: string) => ({
  ARTIFACTS: data.artifacts,
  DB: data.database,
  ENVIRONMENT: environment,
  PROFILE_JOBS: data.profileJobs,
});

export const webBindings = (environment: string) => ({ ENVIRONMENT: environment });

export const apiEntrypoints = (processor: Cloudflare.Worker) => ({
  PROCESSOR: Cloudflare.WorkerEntrypoint(processor),
});

export const webEntrypoints = (api: Cloudflare.Worker) => ({
  API: Cloudflare.WorkerEntrypoint(api),
});

type WorkerEntrypoints = Record<string, Cloudflare.WorkerEntrypointBinding>;

const serviceBinding = (name: string, entrypoint: Cloudflare.WorkerEntrypointBinding) => {
  const binding = {
    type: "service" as const,
    name,
    service: entrypoint.worker.workerName,
  };
  if (entrypoint.entrypoint === undefined) {
    return entrypoint.props === undefined ? binding : { ...binding, props: entrypoint.props };
  }
  return entrypoint.props === undefined
    ? { ...binding, entrypoint: entrypoint.entrypoint }
    : { ...binding, entrypoint: entrypoint.entrypoint, props: entrypoint.props };
};

export const bindWorkerEntrypoints = (
  worker: Cloudflare.Worker,
  entrypoints: WorkerEntrypoints,
) => {
  const bindings: Input<Cloudflare.WorkerBinding[]> = Object.entries(entrypoints).map(
    ([name, entrypoint]) => serviceBinding(name, entrypoint),
  );
  return worker.bind("Entrypoints", { bindings });
};

export type ProcessorEnv = Cloudflare.InferEnv<ReturnType<typeof processorBindings>>;
export type ApiEnv = Cloudflare.InferEnv<
  ReturnType<typeof apiBindings> & ReturnType<typeof apiEntrypoints>
>;
export type WebEnv = Cloudflare.InferEnv<
  ReturnType<typeof webBindings> & ReturnType<typeof webEntrypoints>
>;
