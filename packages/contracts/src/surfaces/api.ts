import { RpcGroup } from "effect/unstable/rpc";

import { getArtifactRpc, listArtifactsRpc } from "../artifacts/api-rpcs.ts";

export class ApiRpcs extends RpcGroup.make(listArtifactsRpc, getArtifactRpc) {}
