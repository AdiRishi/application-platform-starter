import { Schema } from "effect";

export class ProfileFailure extends Schema.TaggedError<ProfileFailure>()("ProfileFailure", {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}
