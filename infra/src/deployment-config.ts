import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as Schema from "effect/Schema";

export const Stage = Schema.Literals(["dev", "prod", "test"]);

export type Stage = typeof Stage.Type;

export const decodeStage = Function.flow(
  Schema.decodeUnknownEffect(Stage),
  Effect.mapError((error) => new Config.ConfigError(error)),
);

export interface DeploymentConfig {
  readonly environment: "local" | "production" | "test";
  readonly stage: Stage;
}

export const deploymentConfig = Effect.fn("ApplicationPlatform.DeploymentConfig")(function* () {
  const stack = yield* Alchemy.Stack;
  const stage = yield* decodeStage(stack.stage);

  return {
    environment: stage === "prod" ? "production" : stage === "dev" ? "local" : "test",
    stage,
  } satisfies DeploymentConfig;
});
