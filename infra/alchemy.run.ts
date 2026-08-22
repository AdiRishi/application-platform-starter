import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { dataPlane } from "./src/data-plane.ts";
import { deploymentConfig } from "./src/deployment-config.ts";
import { project } from "./src/project.ts";
import { webApplication } from "./src/web-application.ts";
import { workerGraph } from "./src/workers.ts";

const Infrastructure = Effect.gen(function* () {
  const stack = yield* Alchemy.Stack;
  if (stack.stage === "placeholder") return {};

  const config = yield* deploymentConfig();
  const data = yield* dataPlane(config);
  const workers = yield* workerGraph(config, data);
  const web = yield* webApplication(config, workers);

  return { ...data, ...workers, web };
});

export default Alchemy.Stack(
  project.stackName,
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Infrastructure,
);
