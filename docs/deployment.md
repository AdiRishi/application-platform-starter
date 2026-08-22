# Deployment

Alchemy defines the full Cloudflare topology in `infra/`. There are no checked
in Wrangler resource identifiers and no separate deployment configuration to
keep synchronized.

```sh
pnpm plan
pnpm deploy
```

The production stage omits the `-dev` suffix used by development resources.
Review the plan before the first deploy because it creates a D1 database, an R2
bucket, two Queues, two private Workers, a public web Worker, and a Durable
Object namespace.

Destroying a stage or changing remote resources is an operator action. Keep
those commands out of automated tests and local setup scripts.
