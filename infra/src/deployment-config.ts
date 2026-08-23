import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as Schema from "effect/Schema";

const Stage = Schema.Literals(["dev", "prod"]);

export const decodeStage = Function.flow(
  Schema.decodeUnknownEffect(Stage),
  Effect.mapError((error) => new Config.ConfigError(error)),
);

export interface DeploymentConfig {
  readonly environment: "local" | "production";
  readonly stage: "dev" | "prod";
}

export const deploymentConfig = Effect.fn("ApplicationPlatform.DeploymentConfig")(function* () {
  const stack = yield* Alchemy.Stack;
  const stage = yield* decodeStage(stack.stage);

  return {
    environment: stage === "prod" ? "production" : "local",
    stage,
  } satisfies DeploymentConfig;
});
