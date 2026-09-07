# Keep platform wiring explicit and the example replaceable

Alchemy owns the resource graph and bindings. Runtimes import inferred environment types; they do not maintain separate deployment configuration. Stage names select a policy in one map, including the environment label and public web origin configuration. Adding staging does not change resource deletion policies.

The web Worker binds only the API. API and processor share D1 and R2 because they implement one application service. They share a trust boundary. A new independently trusted service needs its own storage and narrowly assigned bindings. Service bindings restrict reachability; they do not establish end-user identity.

D1 owns artifact lifecycle and results. The artifact row also records pending queue delivery through a nullable dispatch timestamp. Inserting that row commits both the artifact metadata and the intent to process it. The API writes R2 first, so a committed row has a source object. An interruption before the D1 insert can leave an unreferenced object. The sample does not implement orphan cleanup or deduplicate separate HTTP uploads.

The API attempts dispatch through `waitUntil` after accepting the upload. A scheduled dispatcher retries undispatched queued rows every minute. It sends before marking delivery, so a crash can produce duplicate messages but cannot silently discard pending work. A failed send does not prevent later rows in the batch from being attempted. Eventual delivery assumes the dispatcher and queue recover.

Consumers acknowledge terminal artifacts without reprocessing them. D1 updates only queued or processing rows, so the first committed terminal result wins. Concurrent attempts may repeat computation; they cannot overwrite a terminal result. Malformed CSV is a permanent failure. Storage failures retry through the queue and eventually reach the dead-letter consumer. Progress failures only log a warning.

The Durable Object stores monotonic progress and is never consulted to decide whether a job is complete. Its SQLite table is created idempotently on construction. Resetting progress does not lose a job or a result. The obsolete lifecycle table in existing objects is no longer read; the next progress report initializes the new table.

D1 migration 0002 adds delivery metadata without rewriting existing artifacts. Apply additive schema changes before consumers depend on them; dependency ordering does not make a multi-Worker rollout atomic. Keep old and new callers compatible during deployment.

Internal workspace packages export TypeScript source. Vite, Worker bundling, tests, and the type checker consume the same files, so development needs no parallel compiler. Website build hashes include shared package sources, manifests, the TypeScript configuration, and the lockfile. Generated route trees are committed so a fresh checkout can typecheck before building.

Live verification uses a browser through the public web Worker. Internal Workers remain private in the test stage. A successful HTML response alone does not prove that assets, hydration, service bindings, or upload processing work.

The example demonstrates these patterns without requiring authentication, tenants, an application framework, or a generic job system. Its parser is buffered and deliberately limited to 256 KB.

Effect and Alchemy are pinned to prerelease versions. Dependency updates require the local checks and a live browser run; update the Effect source reference with the pinned version.
