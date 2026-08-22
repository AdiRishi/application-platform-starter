# Architecture

The app profiles one CSV at a time. That gives each Cloudflare resource a real
job while keeping the domain disposable.

```text
browser
   │ upload, list, poll, download
   ▼
web application ──service binding──▶ API Worker
                                         │
                    ┌────────────────────┼──────────────────┐
                    ▼                    ▼                  ▼
              R2 source file       D1 artifact row     profile Queue
                                                              │
                                                              ▼
                                                       processor Worker
                                                         │     │     │
                                                         ▼     ▼     ▼
                                                        R2    D1    Durable Object
                                                              │
                                        failed 3 times ───────┴──▶ DLQ
```

## Ownership

D1 owns durable artifact metadata and completed profiles. R2 owns the uploaded
source bytes. A Durable Object owns the live progress for one artifact. The
Queue owns delivery and retries, and the DLQ converts an exhausted job into a
durable failed artifact.

Only the web Worker has a public route. It forwards `/api/*` through a service
binding. The API and processor Workers have no `workers.dev` routes.

## Why the Durable Object exists

Processing progress changes more often than the permanent profile record and
must stay ordered for one artifact. One object per artifact serializes those
writes. The processor marks the D1 row complete only after the profile is
stored, so D1 remains the source of truth after processing ends.

## Shared contracts

`packages/contracts` contains Effect schemas for queue messages and HTTP
responses. Each Worker imports its environment type from
`infra/src/worker-bindings.ts`, where Alchemy bindings and TypeScript types come
from the same declarations.
