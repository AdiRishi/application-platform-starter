import { RpcGroup } from "effect/unstable/rpc";

import { getArtifactRpc, listArtifactsRpc } from "../artifacts/api-rpcs";

export class ApiRpcs extends RpcGroup.make(listArtifactsRpc, getArtifactRpc) {}
