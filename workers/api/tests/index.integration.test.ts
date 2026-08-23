import { ArtifactSummary } from "@repo/contracts";
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { Schema } from "effect";
import { beforeEach, expect, inject, test } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(env.DB, [...inject("migrations")]);
});

test("an uploaded CSV is listed and downloadable through the API", async () => {
  const source = "date,description,amount\n2026-08-01,Coffee,-4.80\n";
  const form = new FormData();
  form.set("file", new File([source], "transactions.csv", { type: "text/csv" }));

  const upload = await SELF.fetch("https://api.test/api/artifacts", {
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

  const listing = await SELF.fetch("https://api.test/api/artifacts");
  expect(listing.status).toBe(200);
  await expect(listing.json()).resolves.toStrictEqual([artifact]);

  const download = await SELF.fetch(`https://api.test/api/artifacts/${artifact.id}/source`);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toBe(
    'attachment; filename="transactions.csv"',
  );
  await expect(download.text()).resolves.toBe(source);
});

test("an upload rejects files outside the CSV boundary", async () => {
  const form = new FormData();
  form.set("file", new File(["not csv"], "notes.txt", { type: "text/plain" }));

  const response = await SELF.fetch("https://api.test/api/artifacts", {
    body: form,
    method: "POST",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toStrictEqual({
    code: "invalid_request",
    message: "Only .csv files are accepted.",
  });
});
