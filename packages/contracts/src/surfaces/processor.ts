import { RpcGroup } from "effect/unstable/rpc";

import { getProcessingStateRpc } from "../artifacts/processor-rpcs.ts";

export class ProcessorRpcs extends RpcGroup.make(getProcessingStateRpc) {}
