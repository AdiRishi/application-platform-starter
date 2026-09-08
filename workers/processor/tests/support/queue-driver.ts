export const queueDriver = (main: string) => `
import Worker, { CsvProfileSession } from ${JSON.stringify(`./${main}`)};
import { WorkerEntrypoint } from "cloudflare:workers";

export { CsvProfileSession };

export default class extends WorkerEntrypoint {
  getProcessingState(artifactId) {
    return new Worker(this.ctx, this.env).getProcessingState(artifactId);
  }

  queue(batch) {
    return new Worker(this.ctx, this.env).queue(batch);
  }

  async fetch(request) {
    const input = await request.json();
    if (input.operation === "session") {
      const session = this.env.CsvProfileSession.getByName(input.name);
      if (input.action === "progress") {
        await session.progress(input.rowsProcessed, input.totalRows);
        return Response.json(null);
      }
      return Response.json(await session.getState());
    }
    const { queue, body, failDigest } = input;
    const dispositions = new Map();
    const decide = (id, action) => {
      if (!dispositions.has(id)) dispositions.set(id, action);
    };
    const message = {
      id: "delivery", body, attempts: 1, timestamp: new Date(),
      ack() { decide(this.id, "ack"); },
      retry() { decide(this.id, "retry"); },
    };
    const batch = {
      queue, messages: [message],
      ackAll() { message.ack(); },
      retryAll() { message.retry(); },
    };
    const digest = crypto.subtle.digest;
    if (failDigest) crypto.subtle.digest = async () => { throw new Error("Crypto unavailable"); };
    try {
      await new Worker(this.ctx, this.env).queue(batch);
    } finally {
      crypto.subtle.digest = digest;
    }
    return Response.json({
      acks: [...dispositions].filter(([, action]) => action === "ack").map(([id]) => id),
      retries: [...dispositions].filter(([, action]) => action === "retry").map(([id]) => id),
    });
  }
}
`;
