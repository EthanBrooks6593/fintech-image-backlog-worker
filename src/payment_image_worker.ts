import { z } from "zod";
import { clientFromEnvironment, type InfraiClient } from "./infrai_client.js";
import { decideImageAction, paymentEventSchema, type PaymentEvent } from "./payment_risk.js";

const queuedMessageSchema = z.object({
  message_id: z.string(),
  payload: paymentEventSchema,
});

const consumeResultSchema = z.object({ messages: z.array(queuedMessageSchema) });

export type AuditNotification = {
  payment_id: string;
  action: "resized" | "manual_review";
  reason: string;
  occurred_at: string;
  image_result?: unknown;
};

export async function processPaymentImage(
  event: PaymentEvent,
  client: Pick<InfraiClient, "resize">,
): Promise<AuditNotification> {
  const decision = decideImageAction(event);
  if (decision.action === "manual_review") {
    return {
      payment_id: event.payment_id,
      action: "manual_review",
      reason: decision.reason,
      occurred_at: new Date().toISOString(),
    };
  }

  const imageResult = await client.resize(
    {
      image: event.image,
      width: 1280,
      height: 720,
      fit: "contain",
      enlarge: false,
      format: "webp",
      store: true,
    },
    `payment-image:${event.payment_id}`,
  );
  return {
    payment_id: event.payment_id,
    action: "resized",
    reason: decision.reason,
    occurred_at: new Date().toISOString(),
    image_result: imageResult,
  };
}

export async function runOneBatch(): Promise<AuditNotification[]> {
  const client = clientFromEnvironment();
  const consumed = consumeResultSchema.parse(await client.consume(10, 60));
  const notifications: AuditNotification[] = [];
  for (const message of consumed.messages) {
    const notification = await processPaymentImage(message.payload, client);
    notifications.push(notification);
    console.log(JSON.stringify(notification));
  }
  return notifications;
}

const isDirectRun = process.argv[1]?.endsWith("payment_image_worker.ts") ?? false;
if (isDirectRun) {
  runOneBatch().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
