import { ArtifactId, ProcessingState, type ProcessingState as State } from "@repo/contracts";
import type { ProcessorEnv, ProfileSessionBinding } from "@repo/infra/worker-bindings";
import { DurableObject } from "cloudflare:workers";
import { Schema } from "effect";

const decodeArtifactId = Schema.decodeUnknownSync(ArtifactId);
const decodeState = Schema.decodeUnknownSync(ProcessingState);

export class CsvProfileSession
  extends DurableObject<ProcessorEnv>
  implements ProfileSessionBinding
{
  private readonly initialization: Promise<void>;

  constructor(ctx: DurableObjectState, env: ProcessorEnv) {
    super(ctx, env);
    this.initialization = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS profile_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          artifact_id TEXT NOT NULL,
          state_json TEXT NOT NULL
        )
      `);
    });
  }

  private write(state: State): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO profile_state (singleton, artifact_id, state_json)
       VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET artifact_id = excluded.artifact_id,
                                            state_json = excluded.state_json`,
      state.artifactId,
      JSON.stringify(state),
    );
  }

  async initialize(rawArtifactId: ArtifactId): Promise<void> {
    await this.initialization;
    const artifactId = decodeArtifactId(rawArtifactId);
    const row = this.ctx.storage.sql
      .exec<{ artifact_id: string }>("SELECT artifact_id FROM profile_state WHERE singleton = 1")
      .toArray()[0];
    if (row === undefined) this.write({ artifactId, kind: "queued" });
  }

  async getState(rawArtifactId: ArtifactId): Promise<string> {
    await this.initialization;
    const artifactId = decodeArtifactId(rawArtifactId);
    const row = this.ctx.storage.sql
      .exec<{ artifact_id: string; state_json: string }>(
        "SELECT artifact_id, state_json FROM profile_state WHERE singleton = 1",
      )
      .toArray()[0];
    if (row === undefined) {
      const state = { artifactId, kind: "queued" } as const;
      this.write(state);
      return JSON.stringify(state);
    }
    if (row.artifact_id !== artifactId) {
      throw new Error("Artifact id does not match the Durable Object identity.");
    }
    const parsed: unknown = JSON.parse(row.state_json);
    return JSON.stringify(decodeState(parsed));
  }

  async progress(
    rawArtifactId: ArtifactId,
    rowsProcessed: number,
    totalRows: number,
  ): Promise<void> {
    await this.initialization;
    const artifactId = decodeArtifactId(rawArtifactId);
    this.write({ artifactId, kind: "processing", rowsProcessed, totalRows });
  }

  async complete(rawArtifactId: ArtifactId): Promise<void> {
    await this.initialization;
    const artifactId = decodeArtifactId(rawArtifactId);
    this.write({ artifactId, kind: "complete" });
  }

  async fail(rawArtifactId: ArtifactId, message: string): Promise<void> {
    await this.initialization;
    const artifactId = decodeArtifactId(rawArtifactId);
    this.write({ artifactId, kind: "failed", message });
  }
}
