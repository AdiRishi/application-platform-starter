import { fileURLToPath, URL } from "node:url";

import * as Alchemy from "alchemy";
import * as Artifacts from "alchemy/Artifacts";
import * as Cloudflare from "alchemy/Cloudflare";
import { evalStack } from "alchemy/Stack";
import { inMemoryState } from "alchemy/State";
import { toEffect } from "alchemy/Test/Core";
import { Effect, Schema } from "effect";

import { workerCompatibility } from "../../../../infra/src/cloudflare-config.ts";
import Processor from "../../../../infra/src/processor.ts";

const providers = Cloudflare.providers();
const state = inMemoryState();
const outputDirectory = fileURLToPath(new URL("../../.alchemy/processor-tests", import.meta.url));
const build: NonNullable<Cloudflare.WorkerProps["build"]> = { output: { dir: outputDirectory } };
const stack = Alchemy.Stack("ProcessorTest", { providers, state }, Processor);

export const buildProcessor = () =>
  Effect.runPromise(
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy declares its test runtime error channel as any.
    toEffect(
      evalStack(
        stack,
        (compiled) =>
          Effect.gen(function* () {
            const worker = compiled.output;
            const source = yield* Cloudflare.resolveSource({
              main: fileURLToPath(new URL("../../../../infra/src/processor.ts", import.meta.url)),
            });
            const output = yield* source
              .build({
                id: worker.LogicalId,
                workerName: "processor-test",
                compatibility: workerCompatibility,
                entry: { kind: "effect", exports: worker.Props.exports ?? {} },
                stack: { name: compiled.name, stage: compiled.stage },
                env: undefined,
                extraOptions: build,
                assets: undefined,
              })
              .pipe(Effect.provide(Artifacts.scopedArtifacts(worker.FQN)));
            if (output.bundle === undefined) return yield* Effect.die("Processor bundle missing");
            return {
              mainModule: output.bundle.files[0].path,
              modules: Object.fromEntries(
                output.bundle.files
                  .filter((file) => file.path.endsWith(".js"))
                  .map((file) => [
                    file.path,
                    {
                      type: "esm" as const,
                      contents: Schema.decodeUnknownSync(Schema.String)(file.content),
                    },
                  ]),
              ),
            };
          }),
        { stage: "test-deadbeef" },
      ),
      { providers, state },
    ),
  );
