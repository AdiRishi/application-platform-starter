# Alchemy infrastructure

Before changing an Alchemy stack, resource, binding, or live infrastructure
test, fetch [Alchemy's documentation index](https://alchemy.run/llms.txt) and
read the pages relevant to the change. Confirm API details against the installed
Alchemy package when the documentation and the pinned version differ.

Infrastructure tests have two lanes. `pnpm --filter @repo/infra test` runs
credential-free tests for pure infrastructure logic and must not create cloud
resources. `pnpm test:infra-live`, run from the repository root, deploys the real
stack to Cloudflare. The live harness creates a short, unique `test-*` stage for
each run and destroys that stage after the tests.

Keep shared live-test configuration in `infra/tests/support/live-harness.ts`.
Callers must not set environment variables to select test behavior.

Before changing infrastructure test layout or setup, read the
[repository test ADR](../docs/adr/0001-mirror-tests-in-a-tests-directory.mdx).
