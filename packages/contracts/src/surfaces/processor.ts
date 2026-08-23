import { RpcGroup } from "effect/unstable/rpc";

import { getProcessingStateRpc } from "../artifacts/processor-rpcs";

export class ProcessorRpcs extends RpcGroup.make(getProcessingStateRpc) {}
