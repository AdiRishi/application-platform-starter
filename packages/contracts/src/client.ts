import { ApiRpcs } from "./surfaces/api.ts";
import { ProcessorRpcs } from "./surfaces/processor.ts";
import type { ClientFor } from "./transport/client.ts";

export { ApiRpcs, ProcessorRpcs };
export { clientOverBinding, type ClientFor, type ServiceBinding } from "./transport/client.ts";

export type ApiClient = ClientFor<typeof ApiRpcs>;
export type ProcessorClient = ClientFor<typeof ProcessorRpcs>;
