import { ArtifactDetail } from "@repo/contracts/schema";
import { render, screen } from "@testing-library/react";
import { Schema } from "effect";
import { expect, test } from "vitest";

import { ProfileDetail } from "@/components/profile-detail";

test("a completed profile exposes the result and source download", () => {
  const artifact = Schema.decodeUnknownSync(ArtifactDetail)({
    byteSize: 42,
    completedAt: "2026-08-22T00:00:01.000Z",
    contentType: "text/csv",
    createdAt: "2026-08-22T00:00:00.000Z",
    fileName: "transactions.csv",
    id: "28f31da1-a2ed-4f1f-a9d9-463107ad09f0",
    profile: {
      columns: [
        {
          emptyValues: 0,
          kind: "number",
          maximum: 42,
          minimum: -4,
          name: "amount",
          nonEmptyValues: 2,
        },
      ],
      malformedRows: 0,
      preview: [["-4"], ["42"]],
      rowCount: 2,
      sha256: "a".repeat(64),
    },
    status: "complete",
  });

  render(<ProfileDetail artifact={artifact} />);

  expect(screen.getByRole("heading", { name: "transactions.csv" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
    "href",
    "/artifacts/28f31da1-a2ed-4f1f-a9d9-463107ad09f0/source",
  );
  expect(screen.getAllByText("amount")).toHaveLength(2);
  expect(screen.getAllByText("-4")).toHaveLength(2);
});
