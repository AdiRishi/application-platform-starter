import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeStage } from "../src/deployment-config.ts";

it.effect("accepts the supported deployment stages", () =>
  Effect.gen(function* () {
    expect(yield* decodeStage("dev")).toBe("dev");
    expect(yield* decodeStage("prod")).toBe("prod");
    expect(yield* decodeStage("test-deadbeef")).toBe("test-deadbeef");
  }),
);

it.effect("rejects unsupported deployment stages", () =>
  Effect.gen(function* () {
    for (const stage of ["production", "test", "test-local", "test-123"]) {
      const invalid = yield* Effect.flip(decodeStage(stage));
      expect(invalid._tag).toBe("ConfigError");
    }
  }),
);
