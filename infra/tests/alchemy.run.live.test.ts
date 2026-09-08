import { readFile } from "node:fs/promises";

import * as Effect from "effect/Effect";
import { expect } from "vitest";

import Stack from "../alchemy.run.ts";
import {
  afterAll,
  beforeAll,
  deploy,
  destroy,
  getWhenReady,
  launchBrowser,
  test,
} from "./support/live-harness.ts";

const stack = beforeAll(deploy(Stack), { timeout: 600_000 });
afterAll(destroy(Stack), { timeout: 600_000 });

test(
  "a browser uploads, profiles, and downloads through the public application",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    if (websiteUrl === undefined) return yield* Effect.die(new Error("Missing website URL."));
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy declares this readiness helper's error channel as unknown.
    expect((yield* getWhenReady(websiteUrl, { times: 30 })).status).toBe(200);
    const source = yield* Effect.promise(() =>
      readFile(new URL("../../fixtures/transactions.csv", import.meta.url)),
    );
    yield* Effect.acquireUseRelease(
      Effect.promise(launchBrowser),
      (browser) =>
        Effect.promise(async () => {
          const page = await browser.newPage();
          page.setDefaultTimeout(90_000);
          const assetFailures: string[] = [];
          page.on("response", (response) => {
            if (
              ["script", "stylesheet"].includes(response.request().resourceType()) &&
              !response.ok()
            )
              assetFailures.push(response.url());
          });
          await page.goto(websiteUrl);
          const choosing = page.waitForEvent("filechooser");
          await page.getByRole("button", { name: "Choose CSV" }).click();
          await (
            await choosing
          ).setFiles({ name: "transactions.csv", mimeType: "text/csv", buffer: source });
          await page.getByRole("heading", { name: "Column profile" }).waitFor();
          expect(await page.getByText("5 rows", { exact: true }).isVisible()).toBe(true);
          expect(
            await page
              .getByRole("row")
              .filter({ has: page.getByRole("cell", { name: "amount", exact: true }) })
              .innerText(),
          ).toContain("4250");
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
          await page.getByText("Profile not found", { exact: true }).waitFor();
          expect(await page.getByText("Artifact not found.", { exact: true }).isVisible()).toBe(
            true,
          );
          expect(assetFailures).toEqual([]);
        }),
      (browser) => Effect.promise(() => browser.close()),
    );
  }),
  { timeout: 180_000 },
);
