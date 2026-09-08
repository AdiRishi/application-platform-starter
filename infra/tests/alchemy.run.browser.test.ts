import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("a browser uploads, profiles, and downloads through the public application", async ({
  page,
}) => {
  const source = await readFile(new URL("../../fixtures/transactions.csv", import.meta.url));
  const assetFailures: string[] = [];
  page.on("response", (response) => {
    if (["script", "stylesheet"].includes(response.request().resourceType()) && !response.ok())
      assetFailures.push(response.url());
  });
  await page.goto("/");
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose CSV" }).click();
  await (
    await choosing
  ).setFiles({ name: "transactions.csv", mimeType: "text/csv", buffer: source });
  await expect(page.getByRole("heading", { name: "Column profile" })).toBeVisible();
  await expect(page.getByText("5 rows", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ has: page.getByRole("cell", { name: "amount", exact: true }) }),
  ).toContainText("4250");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const download = await downloading;
  const path = await download.path();
  if (path === null) throw new Error("The source download did not finish.");
  expect(await readFile(path)).toEqual(source);
  await page.route("**/_serverFn/**", (route) => {
    const url = route
      .request()
      .url()
      .replace(
        /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/g,
        "11111111-1111-4111-8111-111111111111",
      );
    return route.continue({ url });
  });
  const choosingMissing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose CSV" }).click();
  await (
    await choosingMissing
  ).setFiles({ name: "missing-profile.csv", mimeType: "text/csv", buffer: source });
  await expect(page.getByText("Profile not found", { exact: true })).toBeVisible();
  await expect(page.getByText("Artifact not found.", { exact: true })).toBeVisible();
  expect(assetFailures).toEqual([]);
});
