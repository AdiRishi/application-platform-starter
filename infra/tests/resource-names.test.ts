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
  expect(resourceNames("test")).toStrictEqual({
    bucket: "application-platform-starter-artifacts-test",
    database: "application-platform-starter-artifacts-test",
    queues: {
      deadLetters: "application-platform-starter-profile-jobs-dlq-test",
      profiles: "application-platform-starter-profile-jobs-test",
    },
    workers: {
      api: "application-platform-starter-api-test",
      processor: "application-platform-starter-processor-test",
      web: "application-platform-starter-web-test",
    },
  });
});
