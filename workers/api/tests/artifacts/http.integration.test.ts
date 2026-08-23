import { ArtifactSummary } from "@repo/contracts";
import { exports } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

test("an uploaded CSV is listed and downloadable through the API", async () => {
  const source = "date,description,amount\n2026-08-01,Coffee,-4.80\n";
  const form = new FormData();
  form.set("file", new File([source], "transactions.csv", { type: "text/csv" }));

  const upload = await exports.default.fetch("https://api.test/api/artifacts", {
    body: form,
    method: "POST",
  });
  expect(upload.status).toBe(202);
  const artifact = Schema.decodeUnknownSync(ArtifactSummary)(await upload.json());
  expect(artifact).toMatchObject({
    byteSize: 48,
    contentType: "text/csv",
    fileName: "transactions.csv",
    status: "queued",
  });

  const listing = await exports.default.fetch("https://api.test/api/artifacts");
  expect(listing.status).toBe(200);
  await expect(listing.json()).resolves.toStrictEqual([artifact]);

  const download = await exports.default.fetch(
    `https://api.test/api/artifacts/${artifact.id}/source`,
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toBe(
    'attachment; filename="transactions.csv"',
  );
  await expect(download.text()).resolves.toBe(source);
});

test("an upload rejects files outside the CSV boundary", async () => {
  const form = new FormData();
  form.set("file", new File(["not csv"], "notes.txt", { type: "text/plain" }));

  const response = await exports.default.fetch("https://api.test/api/artifacts", {
    body: form,
    method: "POST",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toStrictEqual({
    code: "invalid_request",
    message: "Only .csv files are accepted.",
  });
});
