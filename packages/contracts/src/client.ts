import { ApiRpcs } from "./surfaces/api";
import { ProcessorRpcs } from "./surfaces/processor";
import type { ClientFor } from "./transport/client";

export { ApiRpcs, ProcessorRpcs };
export { clientOverBinding, type ClientFor, type ServiceBinding } from "./transport/client";

export type ApiClient = ClientFor<typeof ApiRpcs>;
export type ProcessorClient = ClientFor<typeof ProcessorRpcs>;
