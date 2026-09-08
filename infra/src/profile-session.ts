import * as Cloudflare from "alchemy/Cloudflare";

import { profileSession } from "../../workers/processor/src/artifacts/profile-session.ts";

export class CsvProfileSession extends Cloudflare.DurableObject<CsvProfileSession>()(
  "CsvProfileSession",
  profileSession,
) {}
