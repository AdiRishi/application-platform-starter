import { readFile } from "node:fs/promises";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { chromium } from "playwright";
import { expect, inject } from "vitest";

import Stack from "../alchemy.run.ts";
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: !inject("live"),
});

const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ websiteUrl: Schema.String }))),
  ),
  { timeout: 600_000 },
);
afterAll(destroy(Stack), { timeout: 600_000 });

test(
  "the web Worker renders the document through its real API binding",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy declares its readiness helper error channel as unknown.
    const response = yield* Test.getWhenReady(websiteUrl);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    const html = yield* response.text;
    expect(html).toContain("Inspect a CSV");
    expect(html).toContain("No profiles yet");
  }),
);

test(
  "the web Worker validates download routes",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const response = yield* HttpClient.get(`${websiteUrl}/artifacts/invalid/source`);
    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({
      code: "invalid_request",
      message: "The artifact id is invalid.",
    });
  }),
);

for (const request of [
  { name: "cross-site fetch metadata", headers: { "sec-fetch-site": "cross-site" } },
  { name: "a foreign origin", headers: { origin: "https://other.test" } },
  { name: "missing origin evidence", headers: {} },
]) {
  test(
    `server-function requests with ${request.name} are rejected before dispatch`,
    Effect.gen(function* () {
      const { websiteUrl } = yield* stack;
      const response = yield* HttpClient.get(`${websiteUrl}/_serverFn/csrf-probe`, {
        headers: request.headers,
      });
      expect(response.status).toBe(403);
      expect(yield* response.text).toBe("Forbidden");
    }),
  );
}

test(
  "a browser uploads, profiles, and downloads through the public application",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy declares this readiness helper's error channel as unknown.
    expect((yield* Test.getWhenReady(websiteUrl, { times: 30 })).status).toBe(200);
    const source = yield* Effect.promise(() =>
      readFile(new URL("../../fixtures/transactions.csv", import.meta.url)),
    );
    yield* Effect.acquireUseRelease(
      Effect.promise(() => chromium.launch({ headless: true })),
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
