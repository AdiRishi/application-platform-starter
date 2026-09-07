import { appRequestErrorSerialization } from "@repo/contracts/app";
import { createSerializationAdapter } from "@tanstack/react-router";
import { createStart } from "@tanstack/react-start";

export const startInstance = createStart(() => ({
  serializationAdapters: [createSerializationAdapter(appRequestErrorSerialization)],
}));
