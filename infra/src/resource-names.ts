import type { Stage } from "./deployment-config.ts";
import { project } from "./project.ts";

const forStage = (name: string, stage: Stage) =>
  stage === "prod"
    ? `${project.resourcePrefix}-${name}`
    : `${project.resourcePrefix}-${name}-${stage}`;

export const resourceNames = (stage: Stage) => ({
  bucket: forStage("artifacts", stage),
  database: forStage("artifacts", stage),
  queues: {
    deadLetters: forStage("profile-jobs-dlq", stage),
    profiles: forStage("profile-jobs", stage),
  },
  workers: {
    api: forStage("api", stage),
    processor: forStage("processor", stage),
    web: forStage("web", stage),
  },
});

export type ResourceNames = ReturnType<typeof resourceNames>;
