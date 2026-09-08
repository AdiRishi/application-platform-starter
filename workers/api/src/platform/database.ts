import { D1Client } from "@effect/sql-d1";
import { Effect, Layer } from "effect";
import { Reactivity } from "effect/unstable/reactivity";
import { SqlClient } from "effect/unstable/sql";

import { apiRequest } from "./worker-request.ts";

export const databaseLayer = Layer.effect(
  SqlClient.SqlClient,
  Effect.flatMap(apiRequest.service, ({ env }) => D1Client.make({ db: env.DB })),
).pipe(Layer.provide(Reactivity.layer));
