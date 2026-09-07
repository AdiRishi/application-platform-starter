import { AppRequestError } from "@repo/contracts/app";
import { ArtifactNotFound, ArtifactsUnavailable } from "@repo/contracts/schema";
import { Cause, Effect, Schema } from "effect";
import { HttpClientError } from "effect/unstable/http";
import { RpcClientError } from "effect/unstable/rpc";

const isNotFound = Schema.is(ArtifactNotFound);
const isUnavailable = Schema.is(ArtifactsUnavailable);

const isTransientRpcFailure = (failure: RpcClientError.RpcClientError) => {
  const reason = failure.reason;
  if (reason._tag !== "HttpError") return false;
  if (reason.kind === "TransportError") return true;
  return (
    reason.cause instanceof HttpClientError.StatusCodeError &&
    [429, 502, 503, 504].includes(reason.cause.response.status)
  );
};

export const runApiRequest = <A, E>(effect: Effect.Effect<A, E>, signal: AbortSignal): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        const failure = Cause.squash(cause);
        if (isNotFound(failure))
          return Effect.fail(new AppRequestError("not_found", "Artifact not found."));
        const error =
          isUnavailable(failure) ||
          (failure instanceof RpcClientError.RpcClientError && isTransientRpcFailure(failure)) ||
          Cause.isTimeoutError(failure)
            ? new AppRequestError(
                "unavailable",
                "The service is temporarily unavailable. Please try again.",
              )
            : new AppRequestError("internal", "The request could not be completed.");
        return Effect.logError("API request failed", cause).pipe(
          Effect.andThen(Effect.fail(error)),
        );
      }),
    ),
    { signal },
  );
