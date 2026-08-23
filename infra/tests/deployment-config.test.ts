import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeStage } from "../src/deployment-config.ts";

it.effect("accepts deployment stage slugs", () =>
  Effect.gen(function* () {
    expect(yield* decodeStage("dev")).toBe("dev");
    expect(yield* decodeStage("prod")).toBe("prod");
    expect(yield* decodeStage("test")).toBe("test");
    expect(yield* decodeStage("test-local-42")).toBe("test-local-42");
  }),
);

it.effect("rejects deployment stages that are not lowercase slugs", () =>
  Effect.gen(function* () {
    for (const stage of [
      "Test",
      "test_local",
      "-test",
      "test-",
      "test local",
      "test-1234567890123",
    ]) {
      const invalid = yield* Effect.flip(decodeStage(stage));
      expect(invalid._tag).toBe("ConfigError");
    }
  }),
);
