import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import * as Schema from "effect/Schema";

import { Stage } from "../../src/deployment-config.ts";

const stage = Schema.decodeUnknownSync(Stage)(`test-${crypto.randomUUID().slice(0, 8)}`);

const harness = Test.make({
  providers: Cloudflare.providers(),
  stage,
  state: Cloudflare.state(),
});

export const { afterAll, beforeAll, deploy, destroy } = harness;
export const test = harness.test;
export const getWhenReady = Test.getWhenReady;
export const executeWhenReady = Test.executeWhenReady;
