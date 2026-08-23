import { expect, test } from "vitest";

import { resourceNames } from "../src/resource-names.ts";

test("development resources cannot collide with production resources", () => {
  expect(resourceNames("dev")).toStrictEqual({
    bucket: "application-platform-starter-artifacts-dev",
    database: "application-platform-starter-artifacts-dev",
    queues: {
      deadLetters: "application-platform-starter-profile-jobs-dlq-dev",
      profiles: "application-platform-starter-profile-jobs-dev",
    },
    workers: {
      api: "application-platform-starter-api-dev",
      processor: "application-platform-starter-processor-dev",
      web: "application-platform-starter-web-dev",
    },
  });
  expect(Object.values(resourceNames("prod").workers).every((name) => !name.endsWith("-dev"))).toBe(
    true,
  );
});

test("live test resources cannot collide with development resources", () => {
  expect(resourceNames("test-deadbeef")).toStrictEqual({
    bucket: "application-platform-starter-artifacts-test-deadbeef",
    database: "application-platform-starter-artifacts-test-deadbeef",
    queues: {
      deadLetters: "application-platform-starter-profile-jobs-dlq-test-deadbeef",
      profiles: "application-platform-starter-profile-jobs-test-deadbeef",
    },
    workers: {
      api: "application-platform-starter-api-test-deadbeef",
      processor: "application-platform-starter-processor-test-deadbeef",
      web: "application-platform-starter-web-test-deadbeef",
    },
  });
});
