import { ArtifactId, ProcessingState, type ProcessingState as State } from "@repo/contracts";
import type { ProcessorEnv, ProfileSessionBinding } from "@repo/infra/worker-bindings";
import { DurableObject } from "cloudflare:workers";
import { Schema } from "effect";

const decodeArtifactId = Schema.decodeUnknownSync(ArtifactId);
const decodeState = Schema.decodeUnknownSync(ProcessingState);

const schemaMigrations = [
  {
    statements: [
      `CREATE TABLE IF NOT EXISTS profile_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        artifact_id TEXT NOT NULL,
        state_json TEXT NOT NULL
      )`,
    ],
    version: 1,
  },
] as const;

export class CsvProfileSession
  extends DurableObject<ProcessorEnv>
  implements ProfileSessionBinding
{
  constructor(ctx: DurableObjectState, env: ProcessorEnv) {
    super(ctx, env);
    // Workerd owns this promise and blocks every event until the migrations finish.
    // oxlint-disable-next-line typescript/no-floating-promises
    void ctx.blockConcurrencyWhile(() => {
      this.migrate();
      return Promise.resolve();
    });
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = new Set(
      this.ctx.storage.sql
        .exec<{ version: number }>("SELECT version FROM _sql_schema_migrations")
        .toArray()
        .map(({ version }) => version),
    );
    for (const migration of schemaMigrations) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) this.ctx.storage.sql.exec(statement);
      this.ctx.storage.sql.exec(
        "INSERT INTO _sql_schema_migrations (version, applied_at) VALUES (?, ?)",
        migration.version,
        new Date().toISOString(),
      );
    }
  }

  private readRow(): { readonly artifact_id: string; readonly state_json: string } | undefined {
    return this.ctx.storage.sql
      .exec<{ artifact_id: string; state_json: string }>(
        "SELECT artifact_id, state_json FROM profile_state WHERE singleton = 1",
      )
      .toArray()[0];
  }

  private write(state: State): void {
    const encoded = Schema.encodeSync(ProcessingState)(state);
    this.ctx.storage.sql.exec(
      "UPDATE profile_state SET state_json = ? WHERE singleton = 1",
      JSON.stringify(encoded),
    );
  }

  async initialize(rawArtifactId: ArtifactId): Promise<void> {
    const artifactId = decodeArtifactId(rawArtifactId);
    const row = this.readRow();
    if (row === undefined) {
      this.ctx.storage.sql.exec(
        "INSERT INTO profile_state (singleton, artifact_id, state_json) VALUES (1, ?, ?)",
        artifactId,
        JSON.stringify({ kind: "queued" }),
      );
      return;
    }
    if (row.artifact_id !== artifactId) {
      throw new Error("Artifact id does not match the Durable Object identity.");
    }
  }

  async getState(): Promise<{ readonly state: State }> {
    const row = this.readRow();
    if (row === undefined) throw new Error("The profile session has not been initialized.");
    const parsed: unknown = JSON.parse(row.state_json);
    return { state: decodeState(parsed) };
  }

  async progress(rowsProcessed: number, totalRows: number): Promise<void> {
    this.write({ kind: "processing", rowsProcessed, totalRows });
  }

  async complete(): Promise<void> {
    this.write({ kind: "complete" });
  }

  async fail(message: string): Promise<void> {
    this.write({ kind: "failed", message });
  }
}
