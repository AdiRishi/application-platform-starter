import type { ProcessingState } from "@repo/contracts/artifacts";
import { DurableObjectState } from "alchemy/Cloudflare/Workers";
import { Effect } from "effect";

export const profileSession = Effect.succeed(
  Effect.gen(function* () {
    const { raw: state } = yield* DurableObjectState;
    yield* Effect.sync(() =>
      state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS profile_progress (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        rows_processed INTEGER NOT NULL,
        total_rows INTEGER NOT NULL
      )`),
    );

    return {
      getState: Effect.fn("ProfileSession.getState")(function* (): Effect.fn.Return<{
        readonly state: ProcessingState;
      }> {
        const row = yield* Effect.sync(
          () =>
            state.storage.sql
              .exec<{ rows_processed: number; total_rows: number }>(
                "SELECT rows_processed, total_rows FROM profile_progress WHERE singleton = 1",
              )
              .toArray()[0],
        );
        return {
          state:
            row === undefined
              ? { kind: "queued" }
              : {
                  kind: "processing",
                  rowsProcessed: row.rows_processed,
                  totalRows: row.total_rows,
                },
        };
      }),
      progress: (rowsProcessed: number, totalRows: number) =>
        Effect.sync(() => {
          state.storage.sql.exec(
            `INSERT INTO profile_progress VALUES (1, ?, ?)
            ON CONFLICT (singleton) DO UPDATE SET rows_processed = MAX(rows_processed, excluded.rows_processed), total_rows = excluded.total_rows`,
            rowsProcessed,
            totalRows,
          );
        }),
    };
  }),
);
