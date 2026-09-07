import { expect, test } from "vitest";

import type { Stage } from "../src/deployment-config.ts";
import { project } from "../src/project.ts";
import { resourceNames } from "../src/resource-names.ts";

const allNames = (stage: Stage) => {
  const names = resourceNames(stage);
  return [
    names.bucket,
    names.database,
    ...Object.values(names.queues),
    ...Object.values(names.workers),
  ];
};

test("stage namespaces separate resources while preserving the project identity", () => {
  const production = allNames("prod");
  for (const stage of ["dev", "staging", "test-deadbeef"] as const) {
    for (const name of allNames(stage)) {
      expect(name).toMatch(new RegExp(`^${project.resourcePrefix}-.+-${stage}$`));
      expect(name.length).toBeLessThanOrEqual(63);
      expect(production).not.toContain(name);
    }
  }
});
