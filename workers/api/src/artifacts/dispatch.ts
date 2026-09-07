import { ArtifactId, type ProfileJob } from "@repo/contracts/schema";
import { Effect, Schema } from "effect";

export const dispatchProfiles = async (
  db: D1Database,
  queue: Pick<Queue<ProfileJob>, "send">,
): Promise<void> => {
  const pending = await db
    .prepare(
      "SELECT id FROM artifacts WHERE dispatched_at IS NULL AND status = 'queued' ORDER BY created_at LIMIT 100",
    )
    .all();
  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: ArtifactId })))(
    pending.results,
  );
  for (const { id } of rows) {
    try {
      await queue.send({ artifactId: id });
      await db
        .prepare("UPDATE artifacts SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL")
        .bind(new Date().toISOString(), id)
        .run();
    } catch (cause) {
      await Effect.runPromise(
        Effect.logError("Profile delivery failed", cause).pipe(
          Effect.annotateLogs({ artifactId: id }),
        ),
      );
    }
  }
};
