import type { Api } from "@repo/infra/api";
import { Context, Effect, Layer } from "effect";

import { ProfileFailure } from "../artifacts/errors.ts";

type ProfileApi = Pick<
  Api,
  "getProfileSource" | "startProfile" | "completeProfile" | "failProfile"
>;

/** @effect-expect-leaking RuntimeContext */
export class ArtifactClient extends Context.Service<ArtifactClient>()("Processor/ArtifactClient", {
  make: (api: ProfileApi) =>
    Effect.succeed({
      getProfileSource: Effect.fn("ArtifactClient.getProfileSource")(
        (...args: Parameters<ProfileApi["getProfileSource"]>) =>
          api.getProfileSource(...args).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The artifact source could not be read." }),
            ),
          ),
      ),
      startProfile: Effect.fn("ArtifactClient.startProfile")(
        (...args: Parameters<ProfileApi["startProfile"]>) =>
          api.startProfile(...args).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(
              (cause) =>
                new ProfileFailure({
                  cause,
                  message: "The artifact could not be marked as processing.",
                }),
            ),
          ),
      ),
      completeProfile: Effect.fn("ArtifactClient.completeProfile")(
        (...args: Parameters<ProfileApi["completeProfile"]>) =>
          api.completeProfile(...args).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The profile result could not be stored." }),
            ),
          ),
      ),
      failProfile: Effect.fn("ArtifactClient.failProfile")(
        (...args: Parameters<ProfileApi["failProfile"]>) =>
          api.failProfile(...args).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(
              (cause) =>
                new ProfileFailure({ cause, message: "The artifact failure could not be stored." }),
            ),
          ),
      ),
    }),
}) {
  static readonly layer = (api: ProfileApi) =>
    Layer.effect(ArtifactClient, ArtifactClient.make(api));
}
