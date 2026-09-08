import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("the built web Worker renders the document using its API binding", async () => {
  const response = await exports.default.fetch("https://web.test/");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("Inspect a CSV");
  expect(html).toContain("No profiles yet");
});

test("the built web Worker validates download routes", async () => {
  const response = await exports.default.fetch("https://web.test/artifacts/invalid/source");
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "invalid_request",
    message: "The artifact id is invalid.",
  });
});
