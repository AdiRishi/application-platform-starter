import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { env } from "@/lib/env";

export default createServerEntry({
  fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return handler.fetch(request);
    const target = new URL(`${url.pathname}${url.search}`, "https://api.internal");
    return env.API.fetch(new Request(target, request));
  },
});
