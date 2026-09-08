import { fileURLToPath, URL } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { ProcessingState } from "@repo/contracts/artifacts";
import { workerCompatibility } from "@repo/infra/cloudflare-config";
import type { Processor } from "@repo/infra/processor";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { inject, test as base, type TestAPI } from "vitest";

import { queueDriver } from "./queue-driver.ts";

interface Delivery {
  queue: string;
  body: { artifactId: string };
  failDigest?: boolean;
}

export interface Runtime {
  miniflare: Miniflare;
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>;
  artifacts: Awaited<ReturnType<Miniflare["getR2Bucket"]>>;
  jobs: Awaited<ReturnType<Miniflare["getQueueProducer"]>>;
  processor: Pick<ReturnType<typeof toRpcAsync<Processor>>, "getProcessingState">;
  deliver(
    options: Delivery,
  ): Promise<{ readonly acks: readonly string[]; readonly retries: readonly string[] }>;
  session(name: string): {
    progress(rowsProcessed: number, totalRows: number): Promise<void>;
    getState(): Promise<{ readonly state: ProcessingState }>;
  };
}

const createRuntime = async (): Promise<Runtime> => {
  const bundle = inject("processorBundle");
  const miniflare = new Miniflare({
    unsafeInspectDurableObjects: true,
    workers: [
      {
        config: {
          type: "worker",
          name: "processor-test",
          compatibilityDate: workerCompatibility.date,
          compatibilityFlags: workerCompatibility.flags,
          manifest: {
            ...bundle,
            mainModule: "queue-driver.js",
            modules: {
              ...bundle.modules,
              "queue-driver.js": { type: "esm", contents: queueDriver(bundle.mainModule) },
            },
          },
          env: {
            ArtifactsDatabase: { type: "d1", id: "artifacts" },
            ArtifactsBucket: { type: "r2", name: "artifacts" },
            CsvProfileSession: {
              type: "durable-object",
              worker: "processor-test",
              exportName: "CsvProfileSession",
            },
            PROFILE_JOBS: { type: "queue", name: "profile-jobs" },
            ProfileJobs_queueName: { type: "text", value: "profile-jobs" },
            ProfileDeadLetters_queueName: { type: "text", value: "profile-jobs-dlq" },
          },
          exports: { CsvProfileSession: { type: "durable-object", storage: "sqlite" } },
          triggers: [
            {
              type: "queue",
              name: "profile-jobs",
              deadLetterQueue: "profile-jobs-dlq",
              maxBatchSize: 1,
              maxRetries: 3,
            },
            { type: "queue", name: "profile-jobs-dlq", maxBatchSize: 1 },
          ],
        },
      },
    ],
  });
  try {
    const database = await miniflare.getD1Database("ArtifactsDatabase");
    const migrations = fileURLToPath(new URL("../../../../migrations", import.meta.url));
    for (const migration of await readD1Migrations(migrations)) {
      await database.batch(migration.queries.map((query) => database.prepare(query)));
    }
    const artifacts = await miniflare.getR2Bucket("ArtifactsBucket");
    const jobs = await miniflare.getQueueProducer("PROFILE_JOBS");
    const worker = await miniflare.getWorker();
    const processor = toRpcAsync<Processor>(worker);
    return {
      miniflare,
      database,
      artifacts,
      jobs,
      processor,
      deliver: async (options) => {
        const response = await worker.fetch("http://processor.test/queue", {
          method: "POST",
          body: JSON.stringify(options),
        });
        return Schema.decodeUnknownSync(
          Schema.Struct({
            acks: Schema.Array(Schema.String),
            retries: Schema.Array(Schema.String),
          }),
        )(await response.json());
      },
      session: (name: string) => ({
        progress: async (rowsProcessed: number, totalRows: number) => {
          const response = await worker.fetch("http://processor.test/session", {
            method: "POST",
            body: JSON.stringify({
              operation: "session",
              action: "progress",
              name,
              rowsProcessed,
              totalRows,
            }),
          });
          if (!response.ok) throw new Error(await response.text());
          await response.arrayBuffer();
        },
        getState: async () => {
          const response = await worker.fetch("http://processor.test/session", {
            method: "POST",
            body: JSON.stringify({ operation: "session", action: "getState", name }),
          });
          return Schema.decodeUnknownSync(Schema.Struct({ state: ProcessingState }))(
            await response.json(),
          );
        },
      }),
    };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
};

export const test: TestAPI<{ runtime: Runtime }> = base.extend<{ runtime: Runtime }>({
  // oxlint-disable-next-line no-empty-pattern -- Vitest requires destructured fixture dependencies even when none are used.
  runtime: async ({}, use) => {
    const runtime = await createRuntime();
    try {
      await use(runtime);
    } finally {
      await runtime.miniflare.dispose();
    }
  },
});
