import { expect, it } from "@effect/vitest";
import { ArtifactDetail, ProfileJob } from "@repo/contracts";
import { Effect, Schema } from "effect";

it.effect("queue jobs reject identifiers outside the shared contract", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProfileJob)({ artifactId: "not-a-uuid" }),
    );

    expect(failure.message).toMatch(/UUID/);
  }),
);

it.effect("a completed artifact requires its profile", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      Schema.decodeUnknownEffect(ArtifactDetail)({
        byteSize: 12,
        completedAt: "2026-08-22T00:00:00.000Z",
        contentType: "text/csv",
        createdAt: "2026-08-22T00:00:00.000Z",
        fileName: "sample.csv",
        id: "28f31da1-a2ed-4f1f-a9d9-463107ad09f0",
        status: "complete",
      }),
    );

    expect(failure.message).toMatch(/profile/);
  }),
);

it.effect("queued artifact details discard processing-only fields", () =>
  Effect.gen(function* () {
    const detail = yield* Schema.decodeUnknownEffect(ArtifactDetail)({
      byteSize: 12,
      contentType: "text/csv",
      createdAt: "2026-08-22T00:00:00.000Z",
      fileName: "sample.csv",
      id: "28f31da1-a2ed-4f1f-a9d9-463107ad09f0",
      rowsProcessed: 5,
      status: "queued",
      totalRows: 10,
    });

    expect(detail).not.toHaveProperty("rowsProcessed");
    expect(detail).not.toHaveProperty("totalRows");
  }),
);
