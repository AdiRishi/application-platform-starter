import { ArtifactDetail, ProfileJob } from "@repo/contracts";
import { Schema } from "effect";
import { expect, test } from "vitest";

test("queue jobs reject identifiers outside the shared contract", () => {
  expect(() => Schema.decodeUnknownSync(ProfileJob)({ artifactId: "not-a-uuid" })).toThrow(/UUID/);
});

test("a completed artifact requires its profile", () => {
  expect(() =>
    Schema.decodeUnknownSync(ArtifactDetail)({
      byteSize: 12,
      completedAt: "2026-08-22T00:00:00.000Z",
      contentType: "text/csv",
      createdAt: "2026-08-22T00:00:00.000Z",
      fileName: "sample.csv",
      id: "28f31da1-a2ed-4f1f-a9d9-463107ad09f0",
      status: "complete",
    }),
  ).toThrow(/profile/);
});
