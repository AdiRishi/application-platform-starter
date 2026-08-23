import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeStage } from "../src/deployment-config.ts";

it.effect("accepts only the two deployment stages", () =>
  Effect.gen(function* () {
    expect(yield* decodeStage("dev")).toBe("dev");
    expect(yield* decodeStage("prod")).toBe("prod");

    const invalid = yield* Effect.flip(decodeStage("production"));
    expect(invalid._tag).toBe("ConfigError");
  }),
);
