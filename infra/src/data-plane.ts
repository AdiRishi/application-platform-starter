import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { bucketLifecycleRules } from "./cloudflare-config.ts";

export const dataPlane = Effect.gen(function* () {
  const database = yield* Cloudflare.D1.Database("ArtifactsDatabase", {
    migrations: "../migrations",
  });
  const artifacts = yield* Cloudflare.R2.Bucket("ArtifactsBucket", {
    forceDestroy: true,
    lifecycleRules: [...bucketLifecycleRules],
  });
  const deadLetters = yield* Cloudflare.Queues.Queue("ProfileDeadLetters");
  const profileJobs = yield* Cloudflare.Queues.Queue("ProfileJobs");

  return { artifacts, database, deadLetters, profileJobs };
});

export type DataPlane = Effect.Success<typeof dataPlane>;
