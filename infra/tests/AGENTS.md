# Testing infrastructure

Infrastructure has two test lanes.

`pnpm --filter @repo/infra test` runs fast tests for pure infrastructure logic. It must not read cloud credentials or create resources. `pnpm test-live-infra`, run from the repository root, deploys the real Alchemy stack to Cloudflare and requires working Alchemy and Cloudflare credentials. The live suite destroys its stack after the tests. Set `NO_DESTROY=1` only while debugging, then destroy that stage manually. Set `ALCHEMY_TEST_STAGE` to a lowercase, hyphenated slug of no more than 17 characters, such as `test-adi`, when the shared `test` stage is already in use.

Read these references before changing an infrastructure test:

- [The repository test ADR](../../docs/adr/0001-mirror-tests-in-a-tests-directory.mdx)
- [Alchemy testing](https://alchemy.run/testing/)
- [Alchemy test harness](https://alchemy.run/testing/test-harness/)
- [Testing a stack](https://alchemy.run/testing/testing-a-stack/)
- [Testing providers](https://alchemy.run/testing/testing-providers/)
- [Alchemy test observability](https://alchemy.run/testing/observability/)
- [Cloudflare tutorial, part 3](https://alchemy.run/cloudflare/tutorial/part-3/)
- [Effect guidance](../../.repos/effect/LLMS.md)
- [`@effect/vitest` guidance](../../.repos/effect/packages/vitest/README.md)

Keep one `beforeAll(deploy(Stack))` and one matching `afterAll(destroy(Stack))` for a live stack suite. Drive the deployed outputs through their public interface. Use `getWhenReady` or `executeWhenReady` for a newly deployed Worker, and use a bounded `Schedule` when waiting for queues or other asynchronous work. Do not replace Cloudflare with mocks or emulators in the live lane.

`test.provider` is for Alchemy provider lifecycle tests. This repository consumes Alchemy's built-in providers, so application stack tests should use `test` unless the repository adds its own provider.
