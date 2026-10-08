import { createServer } from "node:http";
import { InfraiError, clientFromEnvironment } from "./infrai_client.js";
import { paymentEventSchema } from "./payment_risk.js";

const client = clientFromEnvironment();

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/payments") {
    return send(response, 404, { error: "Route not found" });
  }

  try {
    const body = await readJson(request);
    const parsed = paymentEventSchema.safeParse(body);
    if (!parsed.success) {
      return send(response, 400, { error: "Invalid payment event", issues: parsed.error.issues });
    }

    const event = parsed.data;
    const queued = await client.publish(event, `payment-event:${event.payment_id}`);
    return send(response, 202, {
      payment_id: event.payment_id,
      state: "queued",
      queue_result: queued,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return send(response, 400, { error: "Invalid JSON body" });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, details: error.details });
    }
    return send(response, 502, { error: "UPSTREAM_RESPONSE_ERROR" });
  }
});

function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
      if (raw.length > 100_000) request.destroy(new Error("Request body too large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Payment image intake listening on http://localhost:${port}`));
