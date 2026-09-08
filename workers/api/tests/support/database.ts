import { D1Client } from "@effect/sql-d1";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export const runSql = <A, E>(query: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, query).pipe(Effect.provide(D1Client.layer({ db: env.DB }))),
  );
