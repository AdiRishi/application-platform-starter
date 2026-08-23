import { describe, expect, test } from "vitest";

import { profileCsv } from "../../src/artifacts/profile-csv.ts";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("profileCsv", () => {
  test("reports useful types, ranges, empty cells, and malformed rows", async () => {
    const progress: Array<readonly [number, number]> = [];
    const profile = await profileCsv(
      bytes(
        [
          "date,amount,settled,note",
          "2026-08-01,12.50,true,first",
          "2026-08-03,-4,false,",
          "2026-08-02,8.25,true",
        ].join("\n"),
      ),
      (processed, total) => {
        progress.push([processed, total]);
        return Promise.resolve();
      },
    );

    expect(profile).toMatchObject({
      columns: [
        {
          emptyValues: 0,
          kind: "date",
          maximum: "2026-08-03",
          minimum: "2026-08-01",
          name: "date",
          nonEmptyValues: 3,
        },
        {
          emptyValues: 0,
          kind: "number",
          maximum: 12.5,
          minimum: -4,
          name: "amount",
          nonEmptyValues: 3,
        },
        {
          emptyValues: 0,
          falseValues: 1,
          kind: "boolean",
          name: "settled",
          nonEmptyValues: 3,
          trueValues: 2,
        },
        {
          emptyValues: 2,
          kind: "string",
          name: "note",
          nonEmptyValues: 1,
        },
      ],
      malformedRows: 1,
      rowCount: 3,
    });
    expect(profile.sha256).toBe("d1dbf88ff934dd2613295f3d41282a9f1db0cf075f4e1a018c843244fc1a10c6");
    expect(progress.at(0)).toStrictEqual([0, 3]);
    expect(progress.at(-1)).toStrictEqual([3, 3]);
  });

  test("keeps impossible calendar dates as strings", async () => {
    const profile = await profileCsv(bytes("date\n2026-02-30\n"), () => Promise.resolve());

    expect(profile.columns[0]).toMatchObject({ kind: "string", name: "date" });
  });
});
