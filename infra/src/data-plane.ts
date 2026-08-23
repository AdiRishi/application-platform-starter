import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { bucketLifecycleRules } from "./cloudflare-config.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { resourceNames } from "./resource-names.ts";

export const dataPlane = Effect.fn("ApplicationPlatform.DataPlane")(function* (
  config: DeploymentConfig,
) {
  const names = resourceNames(config.stage);
  const database = yield* Cloudflare.D1.Database("ArtifactsDatabase", {
    name: names.database,
    migrations: "../migrations",
  });
  const artifacts = yield* Cloudflare.R2.Bucket("ArtifactsBucket", {
    name: names.bucket,
    forceDestroy: true,
    lifecycleRules: [...bucketLifecycleRules],
  });
  const deadLetters = yield* Cloudflare.Queues.Queue("ProfileDeadLetters", {
    name: names.queues.deadLetters,
  });
  const profileJobs = yield* Cloudflare.Queues.Queue("ProfileJobs", {
    name: names.queues.profiles,
  });

  return { artifacts, database, deadLetters, profileJobs };
});

export type DataPlane = Effect.Success<ReturnType<typeof dataPlane>>;
